export const atrasoReconexao = (tentativa: number): number => Math.min(1000 * 2 ** tentativa, 60_000)
