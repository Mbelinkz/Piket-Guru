import type { Assignment, Config, SecretsStatus, Staff } from '../../shared/types.ts';
import type { ToastKind } from '../components/ui.tsx';

/** Konteks bersama yang diberikan App ke setiap tampilan. */
export interface AppCtx {
  config: Config;
  staff: Staff[];
  schedule: Assignment[];
  secrets: SecretsStatus;
  isAdmin: boolean;
  defaultCredentials: boolean;
  staffName: (id: string) => string;
  staffObj: (id: string) => Staff | undefined;
  notify: (kind: ToastKind, text: string) => void;
  reload: () => Promise<void>;
  /** Minta PIN admin bila belum; true bila admin terverifikasi. */
  requireAdmin: () => Promise<boolean>;
}
