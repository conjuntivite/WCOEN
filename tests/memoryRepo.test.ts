import { repoContract } from './repo.contract'
import { MemoryRepo } from './memoryRepo'

repoContract('MemoryRepo', async () => new MemoryRepo())
