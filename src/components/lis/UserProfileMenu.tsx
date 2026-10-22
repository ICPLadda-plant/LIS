import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, LogOut, Settings, User, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/AuthContext";
import { normalizeRoles } from "@/lib/roles";
import ProfileSettingsDialog from "./ProfileSettingsDialog";
import {
  SIGNATURE_DEVICE_UNSUPPORTED_MESSAGE,
  canManageSignature,
  isSignatureDeviceSupported,
} from "@/lib/signatureAccess";
import { cn } from "@/lib/utils";

interface UserProfileMenuProps {
  className?: string;
}

const getInitial = (name?: string, email?: string) =>
  (name?.trim().charAt(0) || email?.trim().charAt(0) || "U").toUpperCase();

const UserProfileMenu = ({ className }: UserProfileMenuProps) => {
  const navigate = useNavigate();
  const { user, logout, isPwa = false, accounts = [], activeAccountId, switchAccount, addAccount } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!user) return null;

  const displayName = user.name || user.email || "User";
  const roles = normalizeRoles(user);
  const roleLabel = roles.length > 0 ? roles.join(", ") : "No role";
  const assignment = [user.department, user.position].filter(Boolean).join(" / ") || "Unassigned";
  const showAccountSwitcher = isPwa && accounts.length > 0;
  const showSignatureAction = canManageSignature(roles);

  const handleSwitchAccount = (accountId: string) => {
    if (accountId === activeAccountId) return;
    switchAccount(accountId);
    toast.success("Switched account");
  };

  const handleAddAccount = () => {
    void addAccount().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Could not add account";
      toast.error(message);
    });
  };

  const handleLogout = () => {
    logout();
    toast.success("Signed out");
    navigate("/login", { replace: true });
  };

  const handleAddSignature = () => {
    if (!isSignatureDeviceSupported()) {
      toast.error(SIGNATURE_DEVICE_UNSUPPORTED_MESSAGE);
      return;
    }
    setSettingsOpen(false);
    navigate("/profile/signature");
  };

  const handleOpenSettings = () => {
    setProfileOpen(false);
    setSettingsOpen(true);
  };

  return (
    <>
      <Popover open={profileOpen} onOpenChange={setProfileOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="User profile"
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-full border border-border bg-background hover:bg-accent transition-colors",
              className,
            )}
          >
            <Avatar className="size-8">
              {user.photoUrl ? <AvatarImage src={user.photoUrl} alt={displayName} /> : null}
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {user.photoUrl ? <User /> : getInitial(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center gap-3 border-b p-4">
          <Avatar className="size-10">
            {user.photoUrl ? <AvatarImage src={user.photoUrl} alt={displayName} /> : null}
            <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
              {user.photoUrl ? <User /> : getInitial(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="grid gap-2 p-4 text-xs">
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Role</span>
            <span className="min-w-0 flex-1 truncate text-right font-medium text-foreground">{roleLabel}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Profile</span>
            <span className="min-w-0 flex-1 truncate text-right font-medium text-foreground">{assignment}</span>
          </div>
        </div>

        {showAccountSwitcher && (
          <div className="border-t p-2">
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              <Users className="size-3.5" />
              Switch account
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {accounts.map((account) => {
                const accountName = account.name || account.email;
                const isActive = account.id === activeAccountId || account.isActive;
                return (
                  <button
                    key={account.id}
                    type="button"
                    aria-label={`${isActive ? "Current account" : "Switch to"} ${accountName} ${account.email}`}
                    disabled={isActive}
                    onClick={() => handleSwitchAccount(account.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "cursor-default bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Avatar className="size-7">
                      {account.photoUrl ? <AvatarImage src={account.photoUrl} alt={accountName} /> : null}
                      <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                        {getInitial(account.name, account.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{accountName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
                    </span>
                    {isActive ? <Check className="size-4 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="mt-1 w-full justify-start"
              onClick={handleAddAccount}
            >
              <UserPlus />
              Add account
            </Button>
          </div>
        )}

        <div className="border-t p-2">
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={handleOpenSettings}>
            <Settings />
            ตั้งค่า
          </Button>
        </div>

        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={handleLogout}
          >
            <LogOut />
            Sign out
          </Button>
        </div>
        </PopoverContent>
      </Popover>
      <ProfileSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        showSignatureAction={showSignatureAction}
        onAddSignature={handleAddSignature}
        canTestSounds={roles.includes("admin")}
      />
    </>
  );
};

export default UserProfileMenu;
