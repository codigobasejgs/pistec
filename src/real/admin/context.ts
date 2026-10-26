import { createContext, useContext } from 'react';
import type { AdminRole } from './data';

export const AdminContext = createContext<{ role: AdminRole; email: string; can: (perm: string) => boolean }>({ role: 'auditor', email: '', can: () => false });
export const useAdmin = () => useContext(AdminContext);
