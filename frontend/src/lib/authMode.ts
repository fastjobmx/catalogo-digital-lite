export function isOfflineDemoAuthEnabled(isDevelopment: boolean, flag: string | undefined): boolean {
  return isDevelopment && flag === 'true'
}
