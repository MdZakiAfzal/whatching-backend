export type MessagingBillingMode = 'meta_direct' | 'partner_credit_line';
export type MessagingBillingProvider = 'meta';
export type MessagingBillingCreditSharingStatus =
  | 'not_applicable'
  | 'pending'
  | 'shared'
  | 'revoked';

export interface MessagingBillingState {
  mode: MessagingBillingMode;
  provider: MessagingBillingProvider;
  creditSharingStatus: MessagingBillingCreditSharingStatus;
  lineOfCreditId?: string;
}

export const DEFAULT_MESSAGING_BILLING: MessagingBillingState = {
  mode: 'meta_direct',
  provider: 'meta',
  creditSharingStatus: 'not_applicable',
};

export const getMessagingBillingState = (
  org: { messagingBilling?: Partial<MessagingBillingState> | null } | null | undefined
): MessagingBillingState => ({
  mode: org?.messagingBilling?.mode ?? DEFAULT_MESSAGING_BILLING.mode,
  provider: org?.messagingBilling?.provider ?? DEFAULT_MESSAGING_BILLING.provider,
  creditSharingStatus:
    org?.messagingBilling?.creditSharingStatus ??
    DEFAULT_MESSAGING_BILLING.creditSharingStatus,
  ...(org?.messagingBilling?.lineOfCreditId
    ? { lineOfCreditId: org.messagingBilling.lineOfCreditId }
    : {}),
});
