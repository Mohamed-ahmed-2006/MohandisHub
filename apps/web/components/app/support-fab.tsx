'use client';

import type { SupportTicketCategory, UserRole } from '@mohandishub/shared';
import { LifeBuoy } from 'lucide-react';
import { useState } from 'react';

import { useToast } from '@/components/app/toast';
import { useAuth } from '@/components/auth/auth-provider';
import { useI18n } from '@/lib/i18n/context';
import { toStoredAttachmentUrl } from '@/lib/support/attachment-url';
import { supportApiClient } from '@/lib/support/client';
import { uploadFile } from '@/lib/upload/client';

function roleLabelFor(
  role: UserRole,
  profileModal: { roleCustomer: string; roleExpert: string; roleCraftsman: string; roleBusiness: string },
  adminLabel: string,
): string {
  switch (role) {
    case 'customer':
      return profileModal.roleCustomer;
    case 'expert':
      return profileModal.roleExpert;
    case 'craftsman':
      return profileModal.roleCraftsman;
    case 'business':
      return profileModal.roleBusiness;
    case 'admin':
      return adminLabel;
    default:
      return adminLabel;
  }
}

export const SupportFab = () => {
  const { dictionary } = useI18n();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportTicketCategory>('other');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  const sf = dictionary.supportFab as Record<string, string>;
  const pm = dictionary.profileModal as {
    roleCustomer: string;
    roleExpert: string;
    roleCraftsman: string;
    roleBusiness: string;
  };
  const common = dictionary.common as Record<string, string | undefined>;

  if (!isReady || !isAuthenticated || !authUser || !accessToken || !authGuard.emailVerified) {
    return null;
  }

  const roleText = roleLabelFor(authUser.role, pm, sf.roleAdmin ?? 'Admin');

  const handleClose = () => {
    if (sending) return;
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !body.trim()) return;
    setSending(true);
    try {
      const attachmentUrls: string[] = [];
      for (const file of files.slice(0, 2)) {
        const { url } = await uploadFile(accessToken, file);
        attachmentUrls.push(toStoredAttachmentUrl(url));
      }
      await supportApiClient.createTicket(accessToken, {
        category,
        body: body.trim(),
        ...(attachmentUrls.length ? { attachmentUrls } : {}),
      });
      addToast(common.success ?? 'Success', common.ticketSent ?? 'Sent.');
      setOpen(false);
      setBody('');
      setFiles([]);
      setCategory('other');
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : (common.ticketSendError ?? 'Failed.');
      addToast(common.errorTitle ?? 'Error', detail);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="support-fab-trigger"
        aria-label={sf.openAria}
        onClick={() => setOpen(true)}
      >
        <LifeBuoy size={22} strokeWidth={2} aria-hidden />
      </button>

      {open ? (
        <div className="support-fab-overlay" role="presentation" onClick={handleClose}>
          <div
            className="support-fab-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-fab-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="support-fab-close" onClick={handleClose} aria-label={common.close}>
              ×
            </button>
            <h2 id="support-fab-title" className="support-fab-title">
              {sf.title}
            </h2>

            <form className="support-fab-form" onSubmit={(e) => void handleSubmit(e)}>
              <label className="support-fab-label" htmlFor="support-fab-email">
                {sf.email}
              </label>
              <input
                id="support-fab-email"
                className="support-fab-input"
                value={authUser.email}
                disabled
                readOnly
                autoComplete="email"
              />

              <label className="support-fab-label" htmlFor="support-fab-role">
                {sf.role}
              </label>
              <input id="support-fab-role" className="support-fab-input" value={roleText} disabled readOnly />

              <label className="support-fab-label" htmlFor="support-fab-category">
                {sf.categoryLabel}
              </label>
              <select
                id="support-fab-category"
                className="support-fab-input"
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
              >
                <option value="bug">{sf.categoryBug}</option>
                <option value="suggestion">{sf.categorySuggestion}</option>
                <option value="error">{sf.categoryError}</option>
                <option value="other">{sf.categoryOther}</option>
              </select>

              <label className="support-fab-label" htmlFor="support-fab-body">
                {common.description ?? 'Description'}
              </label>
              <textarea
                id="support-fab-body"
                className="support-fab-textarea"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={sf.descriptionPlaceholder}
                required
                rows={5}
                maxLength={10000}
              />

              <label className="support-fab-label" htmlFor="support-fab-files">
                {sf.imagesHint}
              </label>
              <input
                id="support-fab-files"
                type="file"
                accept="image/*"
                multiple
                className="support-fab-file"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 2))}
              />
              {files.length > 0 ? (
                <p className="support-fab-hint">
                  {files.length} / 2 — {common.maxTwoImages}
                </p>
              ) : null}

              <div className="support-fab-actions">
                <button type="button" className="support-fab-btn support-fab-btn--secondary" onClick={handleClose}>
                  {common.cancel}
                </button>
                <button type="submit" className="support-fab-btn support-fab-btn--primary" disabled={sending || !body.trim()}>
                  {sending ? sf.sending : sf.send}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
};
