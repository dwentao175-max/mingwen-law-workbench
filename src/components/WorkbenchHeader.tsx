import type { ReactNode } from 'react';
import { LogOut, Settings, UserCircle } from 'lucide-react';
import type { Role } from '../lib/apiClient';
import { BrandMark } from './BrandMark';

export type WorkbenchMode = 'compare' | 'interpret';

export function WorkbenchHeader({
  mode,
  showAdmin,
  stepIndicator,
  accountControl,
  onHome,
  onModeChange
}: {
  mode: WorkbenchMode;
  showAdmin: boolean;
  stepIndicator?: ReactNode;
  accountControl: ReactNode;
  onHome: () => void;
  onModeChange: (mode: WorkbenchMode) => void;
}) {
  return (
    <header className="workbench-header">
      <div className="workbench-brand">
        <BrandMark size="compact" />
      </div>
      <div className="workbench-center">
        {!showAdmin ? (
          <nav className="workbench-switch" aria-label="工具切换">
            <button className={mode === 'compare' ? 'active' : ''} onClick={() => onModeChange('compare')}>法规对比</button>
            <button className={mode === 'interpret' ? 'active' : ''} onClick={() => onModeChange('interpret')}>法规解读</button>
          </nav>
        ) : (
          <div className="workbench-switch admin-title">管理后台</div>
        )}
        {stepIndicator && <div className="workbench-step-slot">{stepIndicator}</div>}
      </div>
      <div className="workbench-account">
        <button className="workbench-home-link" onClick={onHome}>首页</button>
        {accountControl}
      </div>
    </header>
  );
}

export function AccountMenu({
  role,
  open,
  onToggle,
  onLogout,
  onSwitchToAdmin,
  onSwitchToUser,
  onOpenAdmin
}: {
  role: Role;
  open: boolean;
  onToggle: () => void;
  onLogout: () => void;
  onSwitchToAdmin: () => void;
  onSwitchToUser: () => void;
  onOpenAdmin: () => void;
}) {
  return (
    <div className="account-menu-wrap">
      <button className="account-trigger" onClick={onToggle} aria-label="账户菜单" aria-expanded={open}>
        <UserCircle size={21} />
      </button>
      {open && (
        <div className="account-menu">
          {role === 'admin' ? (
            <>
              <button onClick={onSwitchToUser}>
                <UserCircle size={15} />
                切换到用户模式
              </button>
              <button onClick={onOpenAdmin}>
                <Settings size={15} />
                管理配置
              </button>
            </>
          ) : (
            <button onClick={onSwitchToAdmin}>
              <Settings size={15} />
              切换到管理员模式
            </button>
          )}
          <button onClick={onLogout}>
            <LogOut size={15} />
            退出
          </button>
        </div>
      )}
    </div>
  );
}
