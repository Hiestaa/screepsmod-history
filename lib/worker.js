log(process.cwd())
const path = require('path')
const requireOpts = {
  paths: require.resolve.paths('@screeps/driver')
}
requireOpts.paths.push(path.resolve(process.cwd(), 'node_modules'))
const engine = require(require.resolve('@screeps/driver', requireOpts))
const common = require(require.resolve('@screeps/common', requireOpts))
const Promise = require('bluebird')
const fs = require('fs')
const shared = require('./shared')

Promise.promisifyAll(fs)

function catchErr (fn) {
  return (...a) => fn(...a).catch(console.error)
}

async function run () {
  await engine.connect('historyWorker')
  const { db, pubsub, env } = common.storage
  pubsub.subscribe('roomsDone', catchErr(async (tick) => {
    const hcs = engine.config.historyChunkSize
    if (tick % hcs === 0) {
      const rooms = (await db.rooms.find()).map(r => r._id)
      for (let baseTick = tick; baseTick > tick - (hcs * 3); baseTick -= hcs) {
        await Promise.all(rooms.map(async room => {
          const key = `roomHistory:${baseTick}:${room}`
          const data = await env.get(key)
          if (!data) return
          await save(room, baseTick, data)
          await env.del(key)
        }))
      }
    }
  }))
}

async function save (roomId, baseTime, data) {
  log('upload', roomId, baseTime)

  let curObjects = JSON.parse(data['' + baseTime] || '{}')
  const result = {
    timestamp: Date.now(),
    room: roomId,
    base: baseTime,
    ticks: {
      [baseTime]: curObjects
    }
  }

  for (let i = 1; i < engine.config.historyChunkSize; i++) {
    const curTick = baseTime + i
    if (data['' + curTick]) {
      const objects = JSON.parse(data['' + curTick])
      const diff = common.getDiff(curObjects, objects)
      result.ticks[curTick] = diff
      curObjects = objects
    } else {
      result.ticks[curTick] = {}
    }
  }

  shared.write(roomId, baseTime, result)
    .catch(err => error(`Error processing room ${roomId}@${baseTime}`, err))
}

run().catch(console.error)

function log (...a) {
  console.log('[historyWorker]', ...a)
}
function error (...a) {
  console.error('[historyWorker]', ...a)
}

process.on('disconnect', () => process.exit())
log('started')
