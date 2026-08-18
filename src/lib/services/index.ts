import 'server-only';
import path from 'node:path';
import { DisabledAiService, PolsiaAiService } from './ai';
import { NoopAnalyticsService, PolsiaAnalyticsService } from './analytics';
import { LocalMailService, PolsiaMailService } from './mail';
import { LocalObjectStorage, PolsiaObjectStorage } from './storage';

export function createServices(config: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = config[name];
    if (!value) throw new Error(`${name} is required for the selected provider`);
    return value;
  };
  return {
    mail:
      config.MAIL_PROVIDER === 'polsia'
        ? new PolsiaMailService(required('POLSIA_EMAIL_PROXY_URL'), required('POLSIA_API_KEY'))
        : new LocalMailService(),
    storage:
      config.STORAGE_PROVIDER === 'polsia'
        ? new PolsiaObjectStorage(required('POLSIA_STORAGE_UPLOAD_URL'), required('POLSIA_API_KEY'))
        : new LocalObjectStorage(
            config.LOCAL_STORAGE_PATH ?? path.join(process.cwd(), '.data', 'objects'),
          ),
    ai:
      config.AI_PROVIDER === 'polsia'
        ? new PolsiaAiService(
            required('POLSIA_AI_BASE_URL'),
            config.POLSIA_API_KEY ?? required('POLSIA_API_TOKEN'),
          )
        : new DisabledAiService(),
    analytics:
      config.ANALYTICS_PROVIDER === 'polsia'
        ? new PolsiaAnalyticsService(
            required('POLSIA_API_BASE_URL'),
            required('POLSIA_ANALYTICS_SLUG'),
          )
        : new NoopAnalyticsService(),
  };
}

export const services = createServices();
