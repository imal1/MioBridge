import * as os from 'os';
import * as path from 'path';

export function getMioBridgeBaseDir(): string {
    if (process.env.MIOBRIDGE_CONFIG_DIR) {
        return process.env.MIOBRIDGE_CONFIG_DIR;
    }

    if (process.env.VERCEL === '1') {
        return path.join(os.tmpdir(), 'miobridge');
    }

    return path.join(os.homedir(), '.config', 'miobridge');
}
