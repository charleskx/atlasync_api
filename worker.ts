import { initSentry, Sentry } from './src/config/sentry'
import { env } from './src/config/env'
import { r2 } from './src/config/r2'
import { createGeocodingWorker } from './src/modules/geocoding/geocoding.worker'
import { createImportWorker } from './src/modules/import/import.worker'

initSentry()

async function main() {
  console.log(`[worker] Starting in ${env.NODE_ENV} mode`)
  console.log(`[worker] R2 configured: ${r2 !== null}, bucket: ${env.R2_BUCKET_NAME ?? 'NOT SET'}`)

  const importWorker = createImportWorker()
  const geocodingWorker = createGeocodingWorker()

  importWorker.on('completed', job => {
    console.log(`[import] Job ${job.id} completed`)
  })
  importWorker.on('failed', (job, err) => {
    console.error(`[import] Job ${job?.id} failed:`, err.message)
    Sentry.captureException(err, { extra: { jobId: job?.id, queue: 'import' } })
  })

  geocodingWorker.on('completed', job => {
    console.log(`[geocoding] Job ${job.id} completed`)
  })
  geocodingWorker.on('failed', (job, err) => {
    console.error(`[geocoding] Job ${job?.id} failed:`, err.message)
    Sentry.captureException(err, { extra: { jobId: job?.id, queue: 'geocoding' } })
  })

  console.log('[worker] Import and geocoding workers running')

  const shutdown = async () => {
    await importWorker.close()
    await geocodingWorker.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
