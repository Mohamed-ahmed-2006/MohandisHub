import type { UserRole } from '@mohandishub/shared';

type RegisterRole = Exclude<UserRole, 'admin'>;

type AuthRoleLabels = {
  customer: string;
  expert: string;
  business: string;
};

type AuthRoleSwitchProps = {
  role: RegisterRole;
  labels: AuthRoleLabels;
  onRoleChange: (nextRole: RegisterRole) => void;
};

const roleOptions: RegisterRole[] = ['customer', 'expert', 'business'];

export const AuthRoleSwitch = ({ role, labels, onRoleChange }: AuthRoleSwitchProps) => {
  return (
    <div className="auth-role-switch" role="tablist" aria-label="Role selection">
      {roleOptions.map((option) => {
        const className = [
          'auth-role-switch-button',
          role === option ? 'auth-role-switch-button-active' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={option}
            type="button"
            className={className}
            onClick={() => onRoleChange(option)}
            role="tab"
            aria-selected={role === option}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
};
