import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { parse } from 'yaml';
import type { StateStore } from '../state/stateStore.js';
export interface AuthConfig { admin_token: string; subscription_token: string; subscription_required: boolean }
const token = () => randomBytes(32).toString('hex');
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export class AuthService {
  constructor(private readonly state: StateStore, private readonly now: () => number = Date.now) {}
  async ensure(newInstall?: boolean): Promise<AuthConfig> {
    return this.state.withLock('auth', async () => {
      const raw = await this.state.get('auth.yaml');
      if (raw) {
        const value = parse(raw) as AuthConfig;
        if (!value || !/^[a-f0-9]{64}$/.test(value.admin_token) || !/^[a-f0-9]{64}$/.test(value.subscription_token) || typeof value.subscription_required !== 'boolean') throw new Error('auth.yaml 无效，请从备份恢复');
        return value;
      }
      const value = { admin_token: token(), subscription_token: token(), subscription_required: newInstall ?? !(await this.state.get('config.yaml') || await this.state.get('nodes.yaml')) };
      await this.state.set('auth.yaml', JSON.stringify(value));
      return value;
    });
  }
  async rotate(subscription = false): Promise<AuthConfig> {
    await this.ensure();
    return this.state.withLock('auth', async () => {
      const value = parse((await this.state.get('auth.yaml'))!) as AuthConfig;
      if (subscription) value.subscription_token = token(); else value.admin_token = token();
      await this.state.set('auth.yaml', JSON.stringify(value)); return value;
    });
  }
  async enableSubscriptions(): Promise<void> {
    await this.ensure();
    await this.state.withLock('auth', async () => {
      const value = parse((await this.state.get('auth.yaml'))!) as AuthConfig;
      value.subscription_required = true;
      await this.state.set('auth.yaml', JSON.stringify(value));
    });
  }
  async login(value: string): Promise<string | null> {
    const config = await this.ensure();
    if (!equal(value, config.admin_token)) return null;
    const payload = `${this.now() + 24 * 3600_000}.${token()}`;
    return `${payload}.${createHmac('sha256', config.admin_token).update(payload).digest('hex')}`;
  }
  async authorized(cookie = '', authorization = ''): Promise<boolean> {
    const config = await this.ensure();
    if (authorization.startsWith('Bearer ') && equal(authorization.slice(7), config.admin_token)) return true;
    const session = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('miobridge_session='))?.slice(18);
    if (!session) return false;
    const [expires, nonce, signature, extra] = session.split('.');
    if (!expires || !nonce || !signature || extra || Number(expires) <= this.now()) return false;
    return equal(signature, createHmac('sha256', config.admin_token).update(`${expires}.${nonce}`).digest('hex'));
  }
  async subscriptionAuthorized(value: string): Promise<boolean> {
    const config = await this.ensure();
    return !config.subscription_required || equal(value, config.subscription_token);
  }
}
