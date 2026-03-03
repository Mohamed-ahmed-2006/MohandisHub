import { redirect } from 'next/navigation';

import { DEFAULT_LOCALE } from '@/lib/i18n/config';

const RootRedirectPage = () => {
  redirect(`/${DEFAULT_LOCALE}`);
};

export default RootRedirectPage;
