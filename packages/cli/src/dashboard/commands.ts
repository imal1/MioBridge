import type { DashboardDaemonStatus, DashboardSystemdService } from './systemd.js';

export type DashboardDaemonAction = 'start' | 'stop' | 'status';

export function formatDashboardDaemonStatus(status: DashboardDaemonStatus): string {
  return `${status.message}\nState: ${status.state}\nEnabled: ${status.enabled ? 'yes' : 'no'}\nLingering: ${status.linger ? 'yes' : 'no'}\nUnit: ${status.unitPath}`;
}

export async function runDashboardDaemonCommand(service: Pick<DashboardSystemdService, DashboardDaemonAction>, action: DashboardDaemonAction): Promise<DashboardDaemonStatus> {
  return service[action]();
}
