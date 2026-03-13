import { notFound } from 'next/navigation';

import { ChatScreen } from '@/components/app/chat-screen';
import { isSupportedLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/get-dictionary';

type ChatPageProps = {
  params: Promise<{ locale: string }>;
};

const ChatPage = async ({ params }: ChatPageProps) => {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const dictionary = await getDictionary(locale);
  return <ChatScreen locale={locale} dictionary={dictionary} />;
};

export default ChatPage;
