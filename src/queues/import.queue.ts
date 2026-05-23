import { Queue } from 'bullmq'
import { redis } from '../config/redis'

export type ImportJobPayload = {
  jobId: string
  tenantId: string
  userId: string
  fileName: string
  r2Key: string   // chave do objeto no R2 (imports/<uuid>.<ext>)
  mode: 'full' | 'incremental'
}

export const importQueue = new Queue<ImportJobPayload>('import', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
})
