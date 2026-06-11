import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_UPDATED_AT_AR,
  LEGAL_UPDATED_AT_EN,
  LEGAL_VERSION,
} from './legal-constants';

import type { Locale } from '@/lib/i18n/types';

export type LegalSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type LegalDocumentContent = {
  updatedLabel: string;
  versionLabel: string;
  updatedAt: string;
  version: string;
  intro: string[];
  sections: LegalSection[];
  contactTitle: string;
  contactLines: string[];
  contactEmail: string;
};

const PRIVACY_EN: LegalDocumentContent = {
  updatedLabel: 'Last updated',
  versionLabel: 'Policy version',
  updatedAt: LEGAL_UPDATED_AT_EN,
  version: LEGAL_VERSION,
  intro: [
    'This Privacy Policy explains how MohandisHub collects, uses, stores, shares, and protects personal data when you use the MohandisHub website and web application, including account, marketplace, verification, wallet, reservation, interview, subscription, support, and dispute features.',
    'MohandisHub is currently a web-only platform. By creating an account, submitting information, or using the platform, you acknowledge the practices described in this Privacy Policy.',
  ],
  sections: [
    {
      title: '1. Scope and Operator',
      paragraphs: [
        'In this Privacy Policy, "MohandisHub", "we", "us", and "our" refer to the MohandisHub platform and the team operating it. Until a formal legal entity name or registered address is published on the platform, MohandisHub is identified by the operating trade name "MohandisHub".',
        'This Privacy Policy applies to information we collect directly from you, automatically through your use of the platform, and from third parties involved in verification, payments, fraud prevention, security, or support workflows.',
      ],
    },
    {
      title: '2. Information We Collect',
      paragraphs: [
        'Depending on how you use MohandisHub, we may collect the following categories of information:',
      ],
      bullets: [
        'Account data such as display name, email address, password hash, phone number, phone code, nationality, date of birth, role, and records of acceptance of our legal terms.',
        'Profile data such as biography, professional or business details, specialties, pricing, city, country, company information, workshop information, portfolio or social links, and avatar or logo images.',
        'Verification data such as identity documents, selfies, academic records, business records, verification provider responses, manual review notes, badge decisions, and verification status history.',
        'Marketplace activity such as services, needs, bids, reservations, interview bookings, applications, milestones, reviews, favorites, notifications, and related metadata.',
        'Wallet and transaction data such as balances, ledger entries, holds, releases, refunds, penalties, withdrawals, payout details, deposit requests, payment references, exchange-rate snapshots, and manual review outcomes.',
        'Communications data such as chat messages, support tickets, ticket attachments, application messages, dispute details, and administrative notices.',
        'Upload data such as files, images, PDFs, videos, CVs, proof-of-payment uploads, identity evidence, and other content you choose to submit.',
        'Technical and usage data such as IP address, approximate country, browser and device details, session data, timestamps, request logs, authentication records, and error or diagnostic data.',
      ],
    },
    {
      title: '3. How We Use Information',
      paragraphs: [
        'We use personal data to operate, secure, and improve MohandisHub, including to:',
      ],
      bullets: [
        'Create accounts, authenticate users, manage sessions, and secure the platform.',
        'Provide marketplace functionality including profiles, search, services, needs, bids, jobs, reservations, messaging, reviews, support, notifications, and subscription access where enabled.',
        'Carry out onboarding, identity verification, business verification, academic verification, trust and safety checks, abuse prevention, and badge decisions.',
        'Operate wallet, deposit, reservation-hold, refund, settlement, withdrawal, interview-fee, and subscription workflows, including manual review where required.',
        'Communicate with you about account activity, verification status, support matters, disputes, security notices, and policy updates.',
        'Detect fraud, enforce our Terms and platform rules, investigate incidents, and protect MohandisHub, our users, and third parties.',
        'Monitor performance, maintain infrastructure, diagnose errors, keep audit trails, and improve platform reliability and usability.',
        'Comply with legal obligations and respond to lawful requests from public authorities or counterparties.',
      ],
    },
    {
      title: '4. Lawful Basis and Justification',
      paragraphs: [
        'Where applicable, we process personal data because processing is necessary to provide the services you request, to perform our contract with you, to comply with legal obligations, to protect legitimate business and security interests, or because you have given consent for a specific activity.',
        'If you withdraw consent for a processing activity that depends on consent, we may stop that activity but may continue other processing that is permitted or required under another lawful basis.',
      ],
    },
    {
      title: '5. Verification, Risk, and Marketplace Trust',
      paragraphs: [
        'MohandisHub may require identity, academic, or business verification before certain accounts, badges, wallet actions, or marketplace features are approved.',
        'At the time of this version, MohandisHub may use Didit for identity-verification workflows and may store verification evidence, provider references, status results, decisions, and related audit history.',
      ],
      bullets: [
        'Verification submissions may be reviewed manually by MohandisHub administrators or staff.',
        'We may approve, reject, request resubmission, suspend access, remove a badge, or keep records needed to investigate misuse or enforce platform rules.',
        'Verification results and trust indicators are platform decisions and may be granted, withheld, or removed at our discretion subject to applicable law.',
      ],
    },
    {
      title: '6. Wallet, Payments, Reservations, and Withdrawals',
      paragraphs: [
        'MohandisHub may operate wallet and transaction-ledger features for platform activity. Wallet balances are platform balances only. They are not bank accounts, savings accounts, or insured deposit products.',
        'At the time of this version, MohandisHub may use NOWPayments for crypto-related payment or payout flows and may support manual InstaPay deposit or withdrawal review flows in which users submit transfer details and proof for review.',
      ],
      bullets: [
        'We may store payment metadata, deposit request details, payout addresses, InstaPay sender or recipient details, proof uploads, transaction references, status changes, compliance flags, and risk-review notes.',
        'Reservations and interview-related transactions may involve holds, releases, refunds, penalties, settlement decisions, and dispute outcomes under a policy snapshot captured for the specific transaction.',
        'Deposits, withdrawals, refunds, or settlement actions may be delayed, blocked, reversed, or rejected when required by law, provider rules, fraud controls, technical issues, or internal compliance review.',
      ],
    },
    {
      title: '7. Communications, Support, and Notifications',
      paragraphs: [
        'We process messages, support tickets, attachments, notifications, and dispute communications so that users can communicate and MohandisHub can provide support, moderation, and issue resolution.',
        'If enabled for a particular workflow, we may also use third-party communication providers to send transactional email, one-time passwords, or service notices.',
      ],
    },
    {
      title: '8. How We Share Information',
      paragraphs: ['We may disclose personal data in the following circumstances:'],
      bullets: [
        'To other users when disclosure is necessary for marketplace functionality, such as profile information, service details, reservation details, applications, reviews, or direct communications.',
        'To service providers and infrastructure partners that support hosting, storage, verification, messaging, geolocation, security, analytics, payments, customer support, and error monitoring.',
        'To payment, verification, or fraud-prevention providers involved in the transaction or verification flow you choose to use.',
        'To professional advisors, auditors, insurers, and contractors who need the information to support our operations under appropriate confidentiality obligations.',
        'To courts, regulators, law-enforcement agencies, tax authorities, or other public authorities where required by law, legal process, or legitimate safety and security needs.',
        'In connection with a merger, financing, acquisition, restructuring, sale of assets, or similar corporate transaction, subject to appropriate confidentiality safeguards where applicable.',
      ],
    },
    {
      title: '9. International Transfers',
      paragraphs: [
        'Some vendors or technical service providers may process data outside your country of residence. When that happens, we use reasonable contractual, organizational, and technical safeguards appropriate to the sensitivity of the data and the operational context.',
      ],
    },
    {
      title: '10. Cookies, Local Storage, and Similar Technologies',
      paragraphs: [
        'MohandisHub uses cookies and similar technologies for authentication, session continuity, security, language and interface preferences, and core feature operation.',
        'We may also use browser storage and similar technologies to preserve session state or improve reliability. If you block or clear these technologies, some parts of the service may not work properly.',
      ],
    },
    {
      title: '11. Retention',
      paragraphs: [
        'We retain personal data only for as long as reasonably necessary for the purposes described in this Privacy Policy, including to provide services, operate payment and dispute workflows, maintain audit and security logs, comply with legal obligations, and resolve complaints or claims.',
        'Different categories of data may be retained for different periods. For example, verification records, payment records, uploaded files, support history, chat records, and security logs may be retained according to operational retention settings, legal requirements, and ongoing dispute or fraud-prevention needs.',
      ],
    },
    {
      title: '12. Security',
      paragraphs: [
        'We use administrative, technical, and organizational measures designed to protect personal data against unauthorized access, disclosure, alteration, misuse, and loss.',
        'No online service can guarantee absolute security. You are responsible for maintaining the confidentiality of your credentials and for notifying us promptly if you believe that your account has been compromised.',
      ],
    },
    {
      title: '13. Your Rights and Choices',
      paragraphs: ['Depending on the law that applies to you, you may have the right to:'],
      bullets: [
        'Access, review, and correct certain personal data held about you.',
        'Request deletion of certain personal data, subject to legal, operational, fraud-prevention, accounting, and dispute-resolution limitations.',
        'Object to, restrict, or request portability of certain processing activities where the law provides those rights.',
        'Withdraw consent for a consent-based activity without affecting earlier lawful processing.',
        'Request account closure or deactivation, understanding that some records may need to be retained.',
      ],
    },
    {
      title: '14. Age Eligibility',
      paragraphs: [
        'MohandisHub is not intended for children. At the time of this version, the platform requires users to be at least 20 years old to register, and we do not knowingly provide the service to users below the applicable platform age threshold.',
      ],
    },
    {
      title: '15. Changes to this Privacy Policy',
      paragraphs: [
        'We may update this Privacy Policy from time to time. If we make changes, we will publish the updated version on this page and update the effective date and version.',
        'Your continued use of MohandisHub after the updated version becomes effective means you acknowledge the revised Privacy Policy to the extent permitted by law.',
      ],
    },
  ],
  contactTitle: 'Contact',
  contactLines: [
    'For privacy requests, data-access requests, or privacy-related complaints, contact us at:',
  ],
  contactEmail: LEGAL_CONTACT_EMAIL,
};

const PRIVACY_AR: LegalDocumentContent = {
  updatedLabel: 'آخر تحديث',
  versionLabel: 'إصدار السياسة',
  updatedAt: LEGAL_UPDATED_AT_AR,
  version: LEGAL_VERSION,
  intro: [
    'توضح سياسة الخصوصية هذه كيفية قيام MohandisHub بجمع البيانات الشخصية واستخدامها وتخزينها ومشاركتها وحمايتها عند استخدامك لموقع ومنصة MohandisHub على الويب، بما في ذلك خصائص الحساب والسوق والتحقق والمحفظة والحجوزات والمقابلات والاشتراكات والدعم والنزاعات.',
    'MohandisHub منصة تعمل عبر الويب فقط في الوقت الحالي. عند إنشاء حساب أو إرسال معلومات أو استخدام المنصة، فإنك تقر بالممارسات الموضحة في سياسة الخصوصية هذه.',
  ],
  sections: [
    {
      title: '1. النطاق وهوية المشغل',
      paragraphs: [
        'في سياسة الخصوصية هذه، تشير عبارات "MohandisHub" و"نحن" و"لنا" إلى منصة MohandisHub والفريق القائم على تشغيلها. وإلى أن يتم نشر اسم كيان قانوني رسمي أو عنوان مسجل على المنصة، يتم تعريف الجهة المشغلة بالاسم التجاري "MohandisHub".',
        'تنطبق هذه السياسة على المعلومات التي نجمعها منك مباشرة، أو تلقائيا أثناء استخدامك للمنصة، أو من أطراف ثالثة تشارك في التحقق أو المدفوعات أو منع الاحتيال أو الأمان أو الدعم.',
      ],
    },
    {
      title: '2. البيانات التي نجمعها',
      paragraphs: ['بحسب طريقة استخدامك لـ MohandisHub، قد نجمع الفئات التالية من البيانات:'],
      bullets: [
        'بيانات الحساب مثل الاسم الظاهر والبريد الإلكتروني وتجزئة كلمة المرور ورقم الهاتف ومفتاح الدولة والجنسية وتاريخ الميلاد والدور وسجلات قبول الشروط القانونية.',
        'بيانات الملف الشخصي مثل النبذة والتفاصيل المهنية أو التجارية والتخصصات والأسعار والمدينة والدولة وبيانات الشركة أو الورشة وروابط الأعمال أو المنصات الاجتماعية وصور الحساب أو الشعار.',
        'بيانات التحقق مثل مستندات الهوية وصور السيلفي والسجلات الأكاديمية والمستندات التجارية وردود مزود التحقق وملاحظات المراجعة وقرارات الشارات وسجل حالات التحقق.',
        'بيانات نشاط السوق مثل الخدمات والطلبات والعروض والحجوزات ومواعيد المقابلات والتقديمات والمراحل والمراجعات والمفضلة والإشعارات وما يرتبط بها من بيانات.',
        'بيانات المحفظة والمعاملات مثل الأرصدة وقيود السجل والحجوزات المالية والإفراجات والاستردادات والغرامات والسحوبات وبيانات الصرف وطلبات الإيداع ومراجع الدفع ولقطات أسعار الصرف ونتائج المراجعة اليدوية.',
        'بيانات التواصل مثل رسائل الدردشة وتذاكر الدعم ومرفقاتها ورسائل التقديم وبيانات النزاعات والإشعارات الإدارية.',
        'بيانات الرفع مثل الملفات والصور وملفات PDF والفيديوهات والسيرة الذاتية وإثباتات الدفع وأدلة الهوية وأي محتوى تختار رفعه.',
        'البيانات التقنية وبيانات الاستخدام مثل عنوان IP والدولة التقريبية وتفاصيل المتصفح والجهاز وبيانات الجلسة والطوابع الزمنية وسجلات الطلبات وسجلات المصادقة وبيانات الأخطاء أو التشخيص.',
      ],
    },
    {
      title: '3. كيف نستخدم المعلومات',
      paragraphs: [
        'نستخدم البيانات الشخصية لتشغيل MohandisHub وتأمينه وتحسينه، بما في ذلك من أجل:',
      ],
      bullets: [
        'إنشاء الحسابات ومصادقة المستخدمين وإدارة الجلسات وتأمين المنصة.',
        'تقديم وظائف السوق بما في ذلك الملفات الشخصية والبحث والخدمات والطلبات والعروض والوظائف والحجوزات والرسائل والمراجعات والدعم والإشعارات والوصول إلى الاشتراكات عند تفعيلها.',
        'تنفيذ إجراءات الانضمام والتحقق من الهوية والتحقق التجاري والتحقق الأكاديمي وفحوصات الثقة والسلامة ومنع الإساءة واتخاذ قرارات الشارات.',
        'تشغيل المحفظة والإيداعات وحجوزات المبالغ والاستردادات والتسويات والسحوبات ورسوم المقابلات والاشتراكات، بما في ذلك المراجعة اليدوية عند الحاجة.',
        'التواصل معك بشأن نشاط الحساب وحالة التحقق ومسائل الدعم والنزاعات والإشعارات الأمنية وتحديثات السياسات.',
        'اكتشاف الاحتيال وفرض الشروط وقواعد المنصة والتحقيق في الحوادث وحماية MohandisHub ومستخدميه والأطراف الثالثة.',
        'مراقبة الأداء وصيانة البنية التحتية وتشخيص الأخطاء والاحتفاظ بسجلات التدقيق وتحسين الاعتمادية وقابلية الاستخدام.',
        'الامتثال للالتزامات القانونية والاستجابة للطلبات النظامية من الجهات العامة أو الأطراف المعنية.',
      ],
    },
    {
      title: '4. الأساس النظامي والمبرر للمعالجة',
      paragraphs: [
        'حيثما ينطبق ذلك، نعالج البيانات الشخصية لأن المعالجة ضرورية لتقديم الخدمات التي تطلبها أو لتنفيذ تعاقدنا معك أو للامتثال لالتزامات قانونية أو لحماية مصالح مشروعة تتعلق بالأعمال والأمن أو لأنك منحت موافقة على نشاط محدد.',
        'إذا سحبت موافقتك على معالجة تعتمد على الموافقة، فقد نتوقف عن ذلك النشاط، لكن قد نستمر في معالجات أخرى تكون مسموحة أو مطلوبة بموجب أساس قانوني آخر.',
      ],
    },
    {
      title: '5. التحقق وإدارة المخاطر والثقة في السوق',
      paragraphs: [
        'قد تتطلب MohandisHub التحقق من الهوية أو البيانات الأكاديمية أو البيانات التجارية قبل اعتماد بعض الحسابات أو الشارات أو عمليات المحفظة أو خصائص السوق.',
        'في تاريخ هذا الإصدار، قد تستخدم MohandisHub خدمة Didit في مسارات التحقق من الهوية، وقد تحتفظ بأدلة التحقق والمراجع الصادرة من المزود ونتائج الحالة والقرارات وسجل المراجعة المرتبط بها.',
      ],
      bullets: [
        'قد تتم مراجعة طلبات التحقق يدويا بواسطة مسؤولي MohandisHub أو موظفيها.',
        'يجوز لنا قبول الطلب أو رفضه أو طلب إعادة الإرسال أو تعليق الوصول أو إزالة شارة أو الاحتفاظ بالسجلات اللازمة للتحقيق في سوء الاستخدام أو فرض قواعد المنصة.',
        'نتائج التحقق ومؤشرات الثقة هي قرارات خاصة بالمنصة ويجوز منحها أو حجبها أو سحبها وفقا لتقديرنا وبما لا يخالف القانون الواجب التطبيق.',
      ],
    },
    {
      title: '6. المحفظة والمدفوعات والحجوزات والسحوبات',
      paragraphs: [
        'قد تشغل MohandisHub خصائص المحفظة وسجل المعاملات الخاصة بأنشطة المنصة. أرصدة المحفظة هي أرصدة تشغيلية داخل المنصة فقط، وليست حسابات بنكية أو حسابات ادخار أو ودائع مؤمنة.',
        'في تاريخ هذا الإصدار، قد تستخدم MohandisHub خدمة NOWPayments في مسارات المدفوعات أو السحوبات المرتبطة بالعملات الرقمية، وقد تدعم مسارات InstaPay اليدوية للإيداع أو السحب حيث يرسل المستخدم تفاصيل التحويل وإثبات العملية للمراجعة.',
      ],
      bullets: [
        'قد نحتفظ ببيانات الدفع المرجعية وتفاصيل طلبات الإيداع وعناوين السحب وبيانات InstaPay وملفات الإثبات وحالات المعاملة ومؤشرات الامتثال وملاحظات المراجعة.',
        'قد تتضمن الحجوزات والمعاملات المرتبطة بالمقابلات حجوزات مالية أو إفراجات أو استردادات أو غرامات أو قرارات تسوية أو نتائج نزاع وفقا لنسخة سياسة مجمدة مرتبطة بالمعاملة نفسها.',
        'يجوز تأخير الإيداعات أو السحوبات أو الاستردادات أو التسويات أو حظرها أو عكسها أو رفضها إذا تطلب القانون ذلك أو فرضته قواعد المزود أو ضوابط الاحتيال أو المشكلات التقنية أو المراجعة الداخلية للامتثال.',
      ],
    },
    {
      title: '7. التواصل والدعم والإشعارات',
      paragraphs: [
        'نعالج الرسائل وتذاكر الدعم والمرفقات والإشعارات ومراسلات النزاعات حتى يتمكن المستخدمون من التواصل وحتى تتمكن MohandisHub من تقديم الدعم والإشراف وحل المشكلات.',
        'إذا تم تفعيل ذلك في مسار معين، فقد نستخدم أيضا مزودي اتصالات خارجيين لإرسال الرسائل البريدية التشغيلية أو رموز التحقق أو إشعارات الخدمة.',
      ],
    },
    {
      title: '8. كيفية مشاركة المعلومات',
      paragraphs: ['قد نكشف البيانات الشخصية في الحالات التالية:'],
      bullets: [
        'لمستخدمين آخرين عندما يكون الإفصاح ضروريا لتشغيل السوق، مثل بيانات الملف الشخصي أو تفاصيل الخدمة أو الحجز أو التقديم أو المراجعات أو الرسائل المباشرة.',
        'لمزودي الخدمات والشركاء التقنيين الذين يدعمون الاستضافة والتخزين والتحقق والمراسلة وتحديد الدولة والأمان والتحليلات والمدفوعات ودعم العملاء ومراقبة الأخطاء.',
        'لمزودي الدفع أو التحقق أو مكافحة الاحتيال المرتبطين بالمعاملة أو بمسار التحقق الذي تختار استخدامه.',
        'للمستشارين المهنيين والمدققين وشركات التأمين والمتعاقدين الذين يحتاجون إلى المعلومات لدعم عملياتنا بموجب التزامات مناسبة بالسرية.',
        'للمحاكم أو الجهات التنظيمية أو جهات إنفاذ القانون أو السلطات الضريبية أو غيرها من الجهات العامة عندما يفرض القانون ذلك أو تقتضيه إجراءات قانونية أو اعتبارات سلامة وأمن مشروعة.',
        'في إطار اندماج أو تمويل أو استحواذ أو إعادة هيكلة أو بيع أصول أو صفقة مماثلة، مع مراعاة الضوابط المناسبة للسرية حيثما ينطبق ذلك.',
      ],
    },
    {
      title: '9. نقل البيانات عبر الحدود',
      paragraphs: [
        'قد يعالج بعض المزودين أو الشركاء التقنيين البيانات خارج بلد إقامتك. وعندما يحدث ذلك، نستخدم ضمانات تعاقدية وتنظيمية وتقنية معقولة تتناسب مع حساسية البيانات وسياق التشغيل.',
      ],
    },
    {
      title: '10. ملفات الارتباط والتخزين المحلي والتقنيات المشابهة',
      paragraphs: [
        'تستخدم MohandisHub ملفات الارتباط والتقنيات المشابهة لأغراض المصادقة واستمرارية الجلسة والأمان وتفضيلات اللغة والواجهة وتشغيل الخصائص الأساسية.',
        'قد نستخدم أيضا التخزين المحلي في المتصفح أو تقنيات مشابهة للحفاظ على حالة الجلسة أو تحسين الاعتمادية. إذا قمت بحظر هذه الوسائل أو مسحها، فقد لا تعمل بعض أجزاء الخدمة بشكل صحيح.',
      ],
    },
    {
      title: '11. الاحتفاظ بالبيانات',
      paragraphs: [
        'نحتفظ بالبيانات الشخصية فقط طالما كان ذلك ضروريا بشكل معقول للأغراض الموضحة في سياسة الخصوصية هذه، بما في ذلك تقديم الخدمات وتشغيل المدفوعات والنزاعات والاحتفاظ بسجلات التدقيق والأمان والامتثال للالتزامات القانونية وتسوية الشكاوى أو المطالبات.',
        'قد تختلف مدد الاحتفاظ بحسب نوع البيانات. فعلى سبيل المثال، قد يتم الاحتفاظ بسجلات التحقق وسجلات الدفع والملفات المرفوعة وسجل الدعم وسجلات الدردشة وسجلات الأمان وفقا لإعدادات التشغيل أو المتطلبات القانونية أو الاحتياجات المرتبطة بالنزاعات أو منع الاحتيال.',
      ],
    },
    {
      title: '12. الأمان',
      paragraphs: [
        'نطبق تدابير إدارية وتقنية وتنظيمية مصممة لحماية البيانات الشخصية من الوصول غير المصرح به أو الإفصاح أو التغيير أو سوء الاستخدام أو الفقد.',
        'لا يمكن لأي خدمة عبر الإنترنت أن تضمن الأمان المطلق. وتقع عليك مسؤولية الحفاظ على سرية بيانات الدخول وإبلاغنا فورا إذا اعتقدت أن حسابك قد تعرض للاختراق.',
      ],
    },
    {
      title: '13. حقوقك وخياراتك',
      paragraphs: ['بحسب القانون المنطبق عليك، قد يكون لك الحق في:'],
      bullets: [
        'الوصول إلى بعض بياناتك الشخصية ومراجعتها وتصحيحها.',
        'طلب حذف بعض البيانات، مع مراعاة القيود القانونية والتشغيلية ومتطلبات منع الاحتيال والمحاسبة وتسوية النزاعات.',
        'الاعتراض على بعض المعالجات أو تقييدها أو طلب نقلها عندما يقرر القانون ذلك.',
        'سحب الموافقة بالنسبة للنشاط القائم على الموافقة دون التأثير على المعالجة السابقة المشروعة.',
        'طلب إغلاق الحساب أو تعطيله مع العلم بأن بعض السجلات قد يلزم الاحتفاظ بها.',
      ],
    },
    {
      title: '14. شرط السن',
      paragraphs: [
        'MohandisHub غير موجه للأطفال. وفي تاريخ هذا الإصدار، تشترط المنصة أن يكون عمر المستخدم 20 سنة على الأقل عند التسجيل، ولا نقدم الخدمة عن علم لمن هم دون الحد العمري المعتمد في المنصة.',
      ],
    },
    {
      title: '15. تحديثات سياسة الخصوصية',
      paragraphs: [
        'يجوز لنا تحديث سياسة الخصوصية من وقت لآخر. وعند إجراء تغييرات، سننشر النسخة المحدثة في هذه الصفحة مع تحديث تاريخ السريان ورقم الإصدار.',
        'استمرارك في استخدام MohandisHub بعد سريان النسخة الجديدة يعني إقرارك بالسياسة المحدثة بالقدر الذي يسمح به القانون.',
      ],
    },
  ],
  contactTitle: 'التواصل',
  contactLines: [
    'للطلبات المتعلقة بالخصوصية أو الوصول إلى البيانات أو الشكاوى المرتبطة بالخصوصية، تواصل معنا عبر:',
  ],
  contactEmail: LEGAL_CONTACT_EMAIL,
};

const TERMS_EN: LegalDocumentContent = {
  updatedLabel: 'Last updated',
  versionLabel: 'Terms version',
  updatedAt: LEGAL_UPDATED_AT_EN,
  version: LEGAL_VERSION,
  intro: [
    'These Terms and Conditions govern your access to and use of the MohandisHub website and web application, including marketplace, verification, wallet, reservation, interview, messaging, support, and subscription features.',
    'By creating an account, accessing, or using MohandisHub, you agree to be bound by these Terms and Conditions. If you do not agree, do not use the platform.',
  ],
  sections: [
    {
      title: '1. Operator and Platform Nature',
      paragraphs: [
        'In these Terms, "MohandisHub", "we", "us", and "our" refer to the MohandisHub platform and the team operating it. Until a formal legal entity name or registered address is published on the platform, MohandisHub is identified by the operating trade name "MohandisHub".',
        'MohandisHub is currently a web-only digital marketplace for engineering, technical, skilled, and related professional services. We provide platform tools, workflow controls, wallets, booking and dispute mechanics, and related infrastructure. We are not the employer, partner, agent, or guarantor of every user on the platform unless we expressly agree otherwise in writing.',
      ],
    },
    {
      title: '2. Eligibility and Account Registration',
      paragraphs: [
        'You must be at least 20 years old and legally capable of entering into binding obligations to use MohandisHub.',
        'You must provide accurate, current, and complete information when registering or using the platform and keep your information updated.',
      ],
      bullets: [
        'You are responsible for safeguarding your login credentials and for all activity conducted through your account.',
        'You may not register an account on behalf of another person or entity without authority.',
        'We may request additional information or verification at any time.',
      ],
    },
    {
      title: '3. Roles, Listings, and User Responsibility',
      paragraphs: [
        'MohandisHub may support different user roles, profiles, and marketplace flows. You are responsible for using the role and features that apply to your account and for ensuring that your listings, services, applications, bids, and profile information are lawful and accurate.',
        'You are solely responsible for the content you publish, the promises you make to other users, and the services or opportunities you offer or accept through the platform.',
      ],
    },
    {
      title: '4. Verification and Trust Features',
      paragraphs: [
        'Some features may require identity, academic, business, or other verification before access is granted. Verification may be handled internally or through third-party providers.',
        'At the time of this version, MohandisHub may use Didit for identity-verification workflows and may also conduct manual review of submitted material.',
      ],
      bullets: [
        'Verification badges, approvals, and trust indicators are platform decisions and may be granted, withheld, suspended, or removed at our discretion subject to applicable law.',
        'A verification result does not guarantee user conduct, service quality, legality, solvency, or future performance.',
      ],
    },
    {
      title: '5. Wallet and Payment Services',
      paragraphs: [
        'MohandisHub may provide wallet, ledger, reservation-hold, refund, penalty, settlement, deposit, and withdrawal functionality. Wallet balances are operating balances within the platform only and do not create a bank, custody, or insured deposit relationship.',
        'At the time of this version, MohandisHub may use NOWPayments for crypto-related flows and may support manual InstaPay flows that require transfer details and proof upload followed by manual review.',
      ],
      bullets: [
        'You are responsible for providing correct payment and payout details.',
        'We may request identity, anti-fraud, source-of-funds, or other compliance information before approving a transaction.',
        'We may delay, block, reverse, or cancel a transaction where required by law, provider rules, technical constraints, fraud controls, sanctions screening, or internal review.',
        'Third-party payment providers operate under their own terms, privacy notices, settlement timing, fees, and technical requirements.',
      ],
    },
    {
      title: '6. Reservations, Holds, Cancellation, and Settlement',
      paragraphs: [
        'MohandisHub may support reservation and interview booking flows that use a policy snapshot captured for the specific transaction. That snapshot may control free-cancellation windows, provider-penalty windows, fixed hold amounts, penalty amounts, and related settlement outcomes.',
        'When a reservation is accepted, funds may be placed on hold. On completion, the transaction may settle to the provider or otherwise be processed according to the applicable transaction rules and dispute outcome.',
      ],
      bullets: [
        'If a customer cancels within the applicable free-cancellation window, the held reservation amount may be refunded to the customer.',
        'If a customer cancels after the free-cancellation window, the held amount may be released to the provider under the captured policy snapshot.',
        'If a provider cancels, the customer may be refunded and, where the cancellation occurs inside a provider-penalty window, a provider penalty may apply.',
        'Pending reservations may be canceled without additional charges where the applicable workflow or preview indicates that outcome.',
        'Interview or job-style reservations may follow specialized fee rules based on actor, timing, failure type, and the captured policy snapshot.',
      ],
    },
    {
      title: '7. Deposits, Withdrawals, and Subscription Access',
      paragraphs: [
        'Deposits add balance or transaction capacity within MohandisHub and may be subject to provider rules, review requirements, and operational limits. Unless required by law or expressly stated for a specific transaction, deposits are not automatically redeemable for cash outside the platform workflow.',
        'Withdrawals are subject to verification, eligibility checks, minimums, supported methods, operational review, and provider or banking constraints.',
      ],
      bullets: [
        'Manual InstaPay deposits or withdrawals may remain pending until proof and transfer details are reviewed.',
        'Withdrawal requests may be canceled, rejected, returned, or adjusted if details are inaccurate, verification is incomplete, fraud or compliance concerns arise, or the payout cannot be completed.',
        'If plan or subscription features are enabled, access is granted for the purchased billing period. Unless required by law or expressly stated otherwise, subscription fees are non-refundable once the subscription period starts.',
      ],
    },
    {
      title: '8. Platform Fees and Pricing',
      paragraphs: [
        'MohandisHub may charge service fees, commissions, processing charges, plan fees, penalties, or other platform charges where disclosed in the product flow, pricing interface, policy snapshot, or transaction record.',
        'We may change fees, limits, payout rules, supported payment methods, or transaction requirements prospectively by updating the product flow, pricing display, or legal terms.',
      ],
    },
    {
      title: '9. User Content and License',
      paragraphs: [
        'You retain ownership of content you submit to MohandisHub, subject to the rights necessary for us to operate the platform.',
        'By submitting content, you grant MohandisHub a non-exclusive, worldwide, royalty-free license to host, store, reproduce, adapt, format, display, and use that content as needed to operate, secure, moderate, improve, and promote the platform and to resolve support, fraud, compliance, or dispute issues.',
      ],
      bullets: [
        'You represent that you have the rights needed to upload and use your content.',
        'You must not upload unlawful, infringing, deceptive, defamatory, abusive, sexually exploitative, malware-related, or privacy-violating material.',
      ],
    },
    {
      title: '10. Prohibited Conduct',
      paragraphs: ['You may not use MohandisHub to:'],
      bullets: [
        'Violate any law, regulation, court order, sanction restriction, or third-party right.',
        'Commit fraud, impersonation, identity misuse, payment abuse, charge manipulation, money laundering, or any deceptive practice.',
        'Circumvent platform fees, booking flows, payment controls, verification requirements, or security restrictions.',
        'Harass, threaten, exploit, or harm other users or collect personal data without lawful basis.',
        'Upload malicious code, interfere with the service, scrape restricted data, or attempt unauthorized access.',
        'Use the platform in a way that risks marketplace integrity, trust, safety, or the proper operation of wallet and dispute systems.',
      ],
    },
    {
      title: '11. Enforcement, Suspension, and Termination',
      paragraphs: [
        'We may monitor platform activity and take action where we believe it is necessary to protect MohandisHub, users, third parties, or the integrity of the platform.',
        'We may suspend, restrict, hold funds, disable features, remove content, reverse access, reject withdrawals, cancel transactions, or terminate accounts if we suspect fraud, policy breaches, unlawful activity, risk to other users, or other conduct inconsistent with these Terms.',
      ],
    },
    {
      title: '12. Disputes Between Users',
      paragraphs: [
        'MohandisHub may provide support, evidence review, and administrative dispute handling for reservations, holds, cancellations, interview fees, refunds, and related transaction outcomes.',
        'Where the platform rules or captured policy snapshot allow it, MohandisHub may decide to refund the customer, release funds to the provider, split an amount, apply a penalty, or maintain a hold pending further review.',
      ],
      bullets: [
        'You agree to provide truthful information and reasonable cooperation in any dispute review.',
        'Our administrative decision for platform-held funds may be final for platform workflow purposes, subject to applicable law.',
      ],
    },
    {
      title: '13. Intellectual Property',
      paragraphs: [
        'The MohandisHub platform, including its software, branding, text, design, databases, workflows, and non-user content, is owned by or licensed to MohandisHub and protected by applicable intellectual-property laws.',
        'Except as expressly allowed by law or by us in writing, you may not copy, modify, distribute, reverse engineer, extract, or commercially exploit any part of the platform.',
      ],
    },
    {
      title: '14. Service Availability and Disclaimers',
      paragraphs: [
        'MohandisHub is provided on an "as is" and "as available" basis to the maximum extent permitted by law. We do not guarantee uninterrupted availability, error-free operation, continuous access to any feature, or the performance, quality, legality, safety, or suitability of any user, service, job, booking, or payment provider.',
        'You use the platform at your own risk and are responsible for your own professional, legal, tax, financial, and commercial decisions.',
      ],
    },
    {
      title: '15. Limitation of Liability',
      paragraphs: [
        'To the maximum extent permitted by law, MohandisHub and its operators, administrators, employees, contractors, and affiliates will not be liable for indirect, incidental, consequential, special, punitive, or exemplary damages, or for loss of profits, revenue, business, goodwill, data, or opportunity arising out of or related to your use of the platform.',
        "To the maximum extent permitted by law, MohandisHub's aggregate liability for claims arising out of or related to the platform will not exceed the greater of the amount of platform fees actually paid by you to MohandisHub in the 12 months before the event giving rise to the claim or EGP 5,000.",
      ],
    },
    {
      title: '16. Indemnity',
      paragraphs: [
        'You agree to defend, indemnify, and hold harmless MohandisHub and its operators, administrators, employees, contractors, and affiliates from and against claims, liabilities, damages, losses, judgments, fines, costs, and expenses arising out of or related to your content, your conduct, your transactions, your violation of these Terms, or your violation of any law or third-party right.',
      ],
    },
    {
      title: '17. Changes to the Platform and Terms',
      paragraphs: [
        'We may change, suspend, or discontinue any feature, role flow, pricing component, payment method, or part of the platform at any time.',
        'We may update these Terms from time to time. The updated version becomes effective when posted unless a different effective timing is stated. Your continued use of MohandisHub after the updated Terms become effective means you accept the revised Terms to the extent permitted by law.',
      ],
    },
    {
      title: '18. Governing Law and Jurisdiction',
      paragraphs: [
        'These Terms are governed by the laws of the Arab Republic of Egypt, without regard to conflict-of-law rules.',
        'Any dispute arising out of or relating to these Terms or your use of MohandisHub shall be subject to the competent courts of Cairo, Egypt, unless mandatory law requires otherwise.',
      ],
    },
  ],
  contactTitle: 'Contact',
  contactLines: ['For legal, contractual, or policy-related questions, contact us at:'],
  contactEmail: LEGAL_CONTACT_EMAIL,
};

const TERMS_AR: LegalDocumentContent = {
  updatedLabel: 'آخر تحديث',
  versionLabel: 'إصدار الشروط',
  updatedAt: LEGAL_UPDATED_AT_AR,
  version: LEGAL_VERSION,
  intro: [
    'تحكم هذه الشروط والأحكام وصولك إلى موقع وتطبيق MohandisHub على الويب واستخدامك لهما، بما في ذلك خصائص السوق والتحقق والمحفظة والحجوزات والمقابلات والرسائل والدعم والاشتراكات.',
    'من خلال إنشاء حساب أو الوصول إلى MohandisHub أو استخدامه، فإنك توافق على الالتزام بهذه الشروط والأحكام. إذا لم توافق، فلا تستخدم المنصة.',
  ],
  sections: [
    {
      title: '1. المشغل وطبيعة المنصة',
      paragraphs: [
        'في هذه الشروط، تشير عبارات "MohandisHub" و"نحن" و"لنا" إلى منصة MohandisHub والفريق القائم على تشغيلها. وإلى أن يتم نشر اسم كيان قانوني رسمي أو عنوان مسجل على المنصة، يتم تعريف الجهة المشغلة بالاسم التجاري "MohandisHub".',
        'MohandisHub منصة رقمية تعمل عبر الويب فقط في الوقت الحالي لعرض وإدارة الخدمات الهندسية والتقنية والحرفية والمهنية ذات الصلة. نحن نوفر أدوات المنصة وضوابط سير العمل وآليات المحفظة والحجز والنزاع والبنية المرتبطة بذلك، ولسنا صاحب عمل أو شريكا أو وكيلا أو ضامنا لكل مستخدم على المنصة ما لم نوافق صراحة على خلاف ذلك كتابة.',
      ],
    },
    {
      title: '2. الأهلية وتسجيل الحساب',
      paragraphs: [
        'يجب أن يكون عمرك 20 سنة على الأقل وأن تكون متمتعا بالأهلية القانونية لإبرام التزامات ملزمة حتى تستخدم MohandisHub.',
        'يجب عليك تقديم معلومات صحيحة وحديثة وكاملة عند التسجيل أو استخدام المنصة، كما يجب عليك تحديثها عند تغيرها.',
      ],
      bullets: [
        'أنت مسؤول عن حماية بيانات الدخول الخاصة بك وعن جميع الأنشطة التي تتم من خلال حسابك.',
        'لا يجوز لك تسجيل حساب نيابة عن شخص أو جهة أخرى دون صلاحية.',
        'يجوز لنا طلب معلومات أو تحقق إضافي في أي وقت.',
      ],
    },
    {
      title: '3. الأدوار والإعلانات ومسؤولية المستخدم',
      paragraphs: [
        'قد تدعم MohandisHub أدوارا مختلفة للمستخدمين وملفات شخصية ومسارات متعددة داخل السوق. وأنت مسؤول عن استخدام الدور والخصائص المناسبة لحسابك وعن التأكد من أن إعلاناتك وخدماتك وتقديماتك وعروضك وبيانات ملفك الشخصي نظامية وصحيحة.',
        'تتحمل وحدك مسؤولية المحتوى الذي تنشره والوعود التي تقدمها للمستخدمين الآخرين والخدمات أو الفرص التي تعرضها أو تقبلها من خلال المنصة.',
      ],
    },
    {
      title: '4. التحقق وخصائص الثقة',
      paragraphs: [
        'قد تتطلب بعض الخصائص التحقق من الهوية أو البيانات الأكاديمية أو التجارية أو غيرها قبل منح الوصول. وقد تتم إجراءات التحقق داخليا أو من خلال مزودي خدمات خارجيين.',
        'في تاريخ هذا الإصدار، قد تستخدم MohandisHub خدمة Didit في مسارات التحقق من الهوية، كما قد تجري مراجعة يدوية للمواد المرسلة.',
      ],
      bullets: [
        'الشارات ونتائج الاعتماد ومؤشرات الثقة هي قرارات خاصة بالمنصة ويجوز منحها أو حجبها أو تعليقها أو سحبها وفقا لتقديرنا وبما لا يخالف القانون الواجب التطبيق.',
        'نتيجة التحقق لا تضمن سلوك المستخدم أو جودة الخدمة أو نظاميتها أو الملاءة أو الأداء المستقبلي.',
      ],
    },
    {
      title: '5. المحفظة وخدمات الدفع',
      paragraphs: [
        'قد توفر MohandisHub وظائف المحفظة والسجل المالي وحجز المبالغ والاسترداد والغرامات والتسوية والإيداع والسحب. أرصدة المحفظة هي أرصدة تشغيلية داخل المنصة فقط ولا تنشئ علاقة بنكية أو حفظ أموال أو وديعة مؤمنة.',
        'في تاريخ هذا الإصدار، قد تستخدم MohandisHub خدمة NOWPayments للمسارات المرتبطة بالعملات الرقمية، وقد تدعم مسارات InstaPay اليدوية التي تتطلب إرسال تفاصيل التحويل ورفع الإثبات ثم انتظار المراجعة اليدوية.',
      ],
      bullets: [
        'أنت مسؤول عن تقديم بيانات دفع وسحب صحيحة.',
        'يجوز لنا طلب معلومات تحقق أو مكافحة احتيال أو مصدر أموال أو أي معلومات امتثال أخرى قبل اعتماد معاملة.',
        'يجوز لنا تأخير معاملة أو حظرها أو عكسها أو إلغاؤها إذا تطلب القانون ذلك أو فرضته قواعد المزود أو القيود التقنية أو ضوابط الاحتيال أو فحص العقوبات أو المراجعة الداخلية.',
        'يخضع مزودو الدفع الخارجيون لشروطهم وسياسات الخصوصية الخاصة بهم وجداول التسوية ورسومهم ومتطلباتهم التقنية.',
      ],
    },
    {
      title: '6. الحجوزات وحجز المبالغ والإلغاء والتسوية',
      paragraphs: [
        'قد تدعم MohandisHub مسارات الحجز والمقابلات التي تستخدم نسخة سياسة مجمدة مرتبطة بالمعاملة نفسها. وقد تتحكم هذه النسخة في نوافذ الإلغاء المجاني ونوافذ غرامة مقدم الخدمة ومبالغ الحجز الثابتة والغرامات ونتائج التسوية المرتبطة بذلك.',
        'عند قبول الحجز، قد يتم وضع المبلغ في حالة حجز. وعند الإتمام، قد تتم تسوية المعاملة لصالح مقدم الخدمة أو التعامل معها وفقا لقواعد المعاملة ونتيجة النزاع المطبقة.',
      ],
      bullets: [
        'إذا ألغى العميل داخل نافذة الإلغاء المجاني المطبقة، فقد يتم رد مبلغ الحجز المحتجز إلى العميل.',
        'إذا ألغى العميل بعد انتهاء نافذة الإلغاء المجاني، فقد يتم الإفراج عن المبلغ المحتجز لصالح مقدم الخدمة وفقا للسياسة المجمدة الخاصة بالمعاملة.',
        'إذا ألغى مقدم الخدمة، فقد يتم رد المبلغ للعميل، وقد تطبق غرامة على مقدم الخدمة إذا وقع الإلغاء داخل نافذة الغرامة الخاصة به.',
        'قد يتم إلغاء الحجوزات المعلقة دون رسوم إضافية عندما يشير سير العمل أو معاينة الإلغاء إلى هذه النتيجة.',
        'قد تخضع المقابلات أو الحجوزات ذات الطابع الوظيفي لقواعد رسوم متخصصة تعتمد على الطرف القائم بالفعل والتوقيت ونوع الفشل والسياسة المجمدة الملتقطة.',
      ],
    },
    {
      title: '7. الإيداعات والسحوبات والوصول إلى الاشتراكات',
      paragraphs: [
        'تضيف الإيداعات رصيدا أو قدرة تنفيذية داخل MohandisHub وقد تخضع لقواعد المزود ومتطلبات المراجعة والحدود التشغيلية. وما لم يفرض القانون خلاف ذلك أو يتم النص صراحة على خلافه في معاملة محددة، فلا تكون الإيداعات قابلة للاسترداد النقدي تلقائيا خارج سير عمل المنصة.',
        'تخضع السحوبات للتحقق وفحوصات الأهلية والحدود الدنيا ووسائل السحب المدعومة والمراجعة التشغيلية وقيود المزود أو البنك.',
      ],
      bullets: [
        'قد تظل طلبات الإيداع أو السحب اليدوية عبر InstaPay معلقة إلى أن تتم مراجعة الإثبات وتفاصيل التحويل.',
        'قد يتم إلغاء طلب السحب أو رفضه أو إرجاعه أو تعديله إذا كانت البيانات غير صحيحة أو كان التحقق غير مكتمل أو ظهرت مخاطر احتيال أو امتثال أو تعذر تنفيذ عملية الصرف.',
        'إذا تم تفعيل خصائص الخطط أو الاشتراكات، فيتم منح الوصول لمدة دورة الفوترة المشتراة. وما لم يفرض القانون خلاف ذلك أو يتم النص صراحة على خلافه، فإن رسوم الاشتراك غير قابلة للاسترداد بعد بدء مدة الاشتراك.',
      ],
    },
    {
      title: '8. رسوم المنصة والتسعير',
      paragraphs: [
        'يجوز لـ MohandisHub فرض رسوم خدمة أو عمولات أو رسوم معالجة أو رسوم خطط أو غرامات أو رسوم أخرى للمنصة عندما يتم الإفصاح عنها داخل مسار المنتج أو واجهة التسعير أو السياسة المجمدة أو سجل المعاملة.',
        'يجوز لنا تغيير الرسوم أو الحدود أو قواعد الصرف أو وسائل الدفع المدعومة أو متطلبات المعاملة مستقبلا من خلال تحديث مسار المنتج أو عرض التسعير أو الشروط القانونية.',
      ],
    },
    {
      title: '9. محتوى المستخدم والترخيص',
      paragraphs: [
        'تظل ملكية المحتوى الذي ترسله إلى MohandisHub لك، مع مراعاة الحقوق اللازمة لنا لتشغيل المنصة.',
        'من خلال إرسال المحتوى، فإنك تمنح MohandisHub ترخيصا غير حصري وعالميا وبدون مقابل لاستضافة المحتوى وتخزينه ونسخه وتكييفه وتنسيقه وعرضه واستخدامه بالقدر اللازم لتشغيل المنصة وتأمينها والإشراف عليها وتحسينها والترويج لها ومعالجة مسائل الدعم أو الاحتيال أو الامتثال أو النزاعات.',
      ],
      bullets: [
        'أنت تقر بأن لديك الحقوق اللازمة لرفع المحتوى واستخدامه.',
        'يجب ألا ترفع مواد غير نظامية أو منتهكة للحقوق أو مضللة أو تشهيرية أو مسيئة أو استغلالية جنسيا أو مرتبطة ببرمجيات خبيثة أو منتهكة للخصوصية.',
      ],
    },
    {
      title: '10. السلوك المحظور',
      paragraphs: ['لا يجوز لك استخدام MohandisHub من أجل:'],
      bullets: [
        'مخالفة أي قانون أو لائحة أو أمر قضائي أو قيود عقوبات أو حق لطرف ثالث.',
        'ارتكاب احتيال أو انتحال أو إساءة استخدام الهوية أو إساءة استخدام المدفوعات أو التلاعب بالرسوم أو غسل الأموال أو أي ممارسة خادعة.',
        'التحايل على رسوم المنصة أو مسارات الحجز أو ضوابط الدفع أو متطلبات التحقق أو القيود الأمنية.',
        'مضايقة المستخدمين الآخرين أو تهديدهم أو استغلالهم أو الإضرار بهم أو جمع بياناتهم الشخصية دون أساس نظامي.',
        'رفع شفرة خبيثة أو التدخل في الخدمة أو كشط البيانات المقيدة أو محاولة الوصول غير المصرح به.',
        'استخدام المنصة على نحو يعرض نزاهة السوق أو الثقة أو السلامة أو التشغيل السليم للمحفظة وأنظمة النزاعات للخطر.',
      ],
    },
    {
      title: '11. الإنفاذ والتعليق وإنهاء الاستخدام',
      paragraphs: [
        'يجوز لنا مراقبة نشاط المنصة واتخاذ الإجراء الذي نراه ضروريا لحماية MohandisHub أو المستخدمين أو الأطراف الثالثة أو سلامة المنصة.',
        'يجوز لنا تعليق الحساب أو تقييده أو حجز الأموال أو تعطيل الخصائص أو إزالة المحتوى أو إيقاف الوصول أو رفض السحوبات أو إلغاء المعاملات أو إنهاء الحساب إذا اشتبهنا في احتيال أو مخالفة للسياسات أو نشاط غير نظامي أو خطر على المستخدمين الآخرين أو أي سلوك يتعارض مع هذه الشروط.',
      ],
    },
    {
      title: '12. النزاعات بين المستخدمين',
      paragraphs: [
        'قد توفر MohandisHub دعما ومراجعة للأدلة ومعالجة إدارية للنزاعات المتعلقة بالحجوزات وحجز المبالغ والإلغاءات ورسوم المقابلات والاستردادات ونتائج المعاملات المرتبطة بذلك.',
        'عندما تسمح قواعد المنصة أو السياسة المجمدة الملتقطة بذلك، يجوز لـ MohandisHub أن تقرر رد المبلغ للعميل أو الإفراج عن الأموال لمقدم الخدمة أو تقسيم المبلغ أو فرض غرامة أو إبقاء المبلغ محجوزا حتى اكتمال المراجعة.',
      ],
      bullets: [
        'أنت توافق على تقديم معلومات صحيحة والتعاون بشكل معقول في أي مراجعة نزاع.',
        'قد يكون قرارنا الإداري بشأن الأموال المحتجزة داخل المنصة نهائيا لأغراض سير عمل المنصة، مع مراعاة ما يفرضه القانون.',
      ],
    },
    {
      title: '13. الملكية الفكرية',
      paragraphs: [
        'منصة MohandisHub، بما في ذلك البرمجيات والعلامات والنصوص والتصميم وقواعد البيانات وسير العمل والمحتوى غير المملوك للمستخدمين، مملوكة لـ MohandisHub أو مرخصة لها ومحمية بموجب قوانين الملكية الفكرية المطبقة.',
        'ما لم يسمح القانون أو نسمح نحن بذلك كتابة، لا يجوز لك نسخ أي جزء من المنصة أو تعديله أو توزيعه أو إجراء هندسة عكسية عليه أو استخراجه أو استغلاله تجاريا.',
      ],
    },
    {
      title: '14. إتاحة الخدمة وإخلاء المسؤولية',
      paragraphs: [
        'يتم توفير MohandisHub على أساس "كما هي" و"حسب التوفر" إلى أقصى حد يسمح به القانون. ولا نضمن التوفر المستمر أو التشغيل الخالي من الأخطاء أو الوصول الدائم إلى أي خاصية أو أداء أو جودة أو نظامية أو سلامة أو ملاءمة أي مستخدم أو خدمة أو وظيفة أو حجز أو مزود دفع.',
        'أنت تستخدم المنصة على مسؤوليتك الخاصة وتتحمل مسؤولية قراراتك المهنية والقانونية والضريبية والمالية والتجارية.',
      ],
    },
    {
      title: '15. تحديد المسؤولية',
      paragraphs: [
        'إلى أقصى حد يسمح به القانون، لا تتحمل MohandisHub أو القائمون على تشغيلها أو مسؤولوها أو موظفوها أو متعاقدوها أو الجهات التابعة لها المسؤولية عن أي أضرار غير مباشرة أو تبعية أو خاصة أو عقابية أو نموذجية أو عن فقد الأرباح أو الإيرادات أو الأعمال أو السمعة أو البيانات أو الفرص الناشئة عن استخدامك للمنصة أو المرتبطة به.',
        'إلى أقصى حد يسمح به القانون، لا تتجاوز المسؤولية الإجمالية لـ MohandisHub عن المطالبات الناشئة عن المنصة أو المرتبطة بها القيمة الأكبر بين رسوم المنصة التي دفعتها فعليا إلى MohandisHub خلال الاثني عشر شهرا السابقة للحدث محل المطالبة أو مبلغ 5000 جنيه مصري.',
      ],
    },
    {
      title: '16. التعويض',
      paragraphs: [
        'توافق على الدفاع عن MohandisHub والقائمين على تشغيلها ومسؤوليها وموظفيها ومتعاقديها والجهات التابعة لها وتعويضهم وإبراء ذمتهم من أي مطالبات أو التزامات أو أضرار أو خسائر أو أحكام أو غرامات أو تكاليف أو مصروفات تنشأ عن محتواك أو سلوكك أو معاملاتك أو مخالفتك لهذه الشروط أو مخالفتك لأي قانون أو حق لطرف ثالث.',
      ],
    },
    {
      title: '17. التغييرات على المنصة والشروط',
      paragraphs: [
        'يجوز لنا تغيير أي خاصية أو مسار دور أو مكون تسعير أو وسيلة دفع أو أي جزء من المنصة أو تعليقه أو إيقافه في أي وقت.',
        'يجوز لنا تحديث هذه الشروط من وقت لآخر. وتصبح النسخة المحدثة نافذة عند نشرها ما لم يذكر توقيت مختلف للسريان. ويعني استمرارك في استخدام MohandisHub بعد نفاذ الشروط المحدثة أنك تقبل النسخة المعدلة بالقدر الذي يسمح به القانون.',
      ],
    },
    {
      title: '18. القانون الواجب التطبيق والاختصاص القضائي',
      paragraphs: [
        'تخضع هذه الشروط لقوانين جمهورية مصر العربية دون اعتبار لقواعد تنازع القوانين.',
        'يخضع أي نزاع ينشأ عن هذه الشروط أو يتعلق بها أو باستخدامك لـ MohandisHub لاختصاص المحاكم المختصة في القاهرة، مصر، ما لم يفرض القانون الآمر خلاف ذلك.',
      ],
    },
  ],
  contactTitle: 'التواصل',
  contactLines: ['للاستفسارات القانونية أو التعاقدية أو المتعلقة بالسياسات، تواصل معنا عبر:'],
  contactEmail: LEGAL_CONTACT_EMAIL,
};

export const getPrivacyContent = (locale: Locale): LegalDocumentContent => {
  return locale === 'ar' ? PRIVACY_AR : PRIVACY_EN;
};

export const getTermsContent = (locale: Locale): LegalDocumentContent => {
  return locale === 'ar' ? TERMS_AR : TERMS_EN;
};
