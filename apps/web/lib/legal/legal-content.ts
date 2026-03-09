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
};

const PRIVACY_EN: LegalDocumentContent = {
  updatedLabel: 'Last updated',
  versionLabel: 'Policy version',
  updatedAt: 'March 9, 2026',
  version: '2026-03',
  intro: [
    'This Privacy Policy explains how MohandisHub collects, uses, discloses, and protects personal data when you access our website, mobile or web application, and related services.',
    'MohandisHub is an engineering services marketplace that connects customers with experts and businesses. By using the platform, you acknowledge the practices described in this Privacy Policy.',
  ],
  sections: [
    {
      title: '1. Information We Collect',
      paragraphs: ['We may collect the following categories of information:'],
      bullets: [
        'Account and identity information, including name, email, phone, date of birth, and role.',
        'Profile and verification information, including professional details and identity/academic/business documents submitted for verification.',
        'Service and transaction information, including needs, bids, services, bookings, wallet activity, and payment metadata.',
        'Communication data, including messages sent through in-app chat and support channels.',
        'Technical and usage data, including IP address, browser/device details, log events, and interaction analytics.',
        'Uploaded files and media, including documents and images you choose to upload.',
      ],
    },
    {
      title: '2. How We Use Information',
      paragraphs: ['We use personal data to:'],
      bullets: [
        'Create and manage accounts, authenticate users, and secure sessions.',
        'Operate marketplace features such as profiles, services, needs, bids, chat, and wallet-ledger operations.',
        'Verify eligibility, identity, and compliance status for experts and businesses.',
        'Process deposits, payment-related events, and transaction records.',
        'Provide customer support, service communications, and account notices.',
        'Monitor abuse, detect fraud, investigate incidents, and enforce platform rules.',
        'Improve product quality, performance, reliability, and user experience.',
      ],
    },
    {
      title: '3. Legal Bases for Processing',
      paragraphs: [
        'Where applicable, we process data based on contract performance, legitimate interests, legal obligations, and consent (for specific processing where consent is required).',
      ],
    },
    {
      title: '4. How We Share Information',
      paragraphs: ['We may share data with:'],
      bullets: [
        'Other users, when necessary to deliver marketplace functionality (for example, customer-provider interaction details).',
        'Service providers that support infrastructure, hosting, communications, analytics, verification, and payment workflows.',
        'Regulators, law enforcement, courts, or governmental authorities when legally required or when necessary to protect rights, safety, and security.',
        'Professional advisors and auditors under confidentiality obligations.',
      ],
    },
    {
      title: '5. International Transfers',
      paragraphs: [
        'Some service providers may process data in jurisdictions outside your country. When this occurs, we apply reasonable safeguards appropriate to the sensitivity of the data and operational risk.',
      ],
    },
    {
      title: '6. Data Retention',
      paragraphs: [
        'We retain personal data for as long as needed to provide services, meet legal/accounting obligations, resolve disputes, and enforce agreements. Retention periods vary by data type, operational need, and legal requirements.',
      ],
    },
    {
      title: '7. Security Measures',
      paragraphs: [
        'We use administrative, technical, and organizational safeguards designed to protect data against unauthorized access, loss, misuse, or alteration. No system can guarantee absolute security, but we continuously improve our controls.',
      ],
    },
    {
      title: '8. Your Rights and Choices',
      paragraphs: ['Depending on applicable law, you may have rights to:'],
      bullets: [
        'Access, review, or correct your personal information.',
        'Request deletion of certain personal data, subject to legal and operational limits.',
        'Object to or restrict specific processing activities.',
        'Withdraw consent where processing relies on consent.',
        'Request account deactivation.',
      ],
    },
    {
      title: '9. Children and Age Eligibility',
      paragraphs: [
        'MohandisHub is not intended for children. You must meet minimum age requirements applicable to account registration and platform use.',
      ],
    },
    {
      title: '10. Cookies and Similar Technologies',
      paragraphs: [
        'We use cookies and similar technologies for authentication, security, preferences, session continuity, and product analytics. You can adjust browser settings, but some platform features may not function properly if cookies are disabled.',
      ],
    },
    {
      title: '11. Policy Updates',
      paragraphs: [
        'We may update this Privacy Policy from time to time. Updated versions are posted on this page with a revised update date and version.',
      ],
    },
  ],
  contactTitle: 'Contact Us',
  contactLines: [
    'For privacy-related inquiries or requests, contact us at',
    'support@mohandishub.com',
  ],
};

const PRIVACY_AR: LegalDocumentContent = {
  updatedLabel: 'آخر تحديث',
  versionLabel: 'إصدار السياسة',
  updatedAt: '9 مارس 2026',
  version: '2026-03',
  intro: [
    'توضح سياسة الخصوصية هذه كيفية جمع MohandisHub للبيانات الشخصية واستخدامها والإفصاح عنها وحمايتها عند استخدام الموقع أو التطبيق والخدمات المرتبطة به.',
    'MohandisHub منصة خدمات هندسية تربط العملاء بالخبراء والشركات. باستخدامك للمنصة، فأنت تقر بالممارسات الموضحة في هذه السياسة.',
  ],
  sections: [
    {
      title: '1. البيانات التي نجمعها',
      paragraphs: ['قد نجمع الفئات التالية من البيانات:'],
      bullets: [
        'بيانات الحساب والهوية مثل الاسم والبريد الإلكتروني ورقم الهاتف وتاريخ الميلاد والدور.',
        'بيانات الملف الشخصي والتحقق، بما في ذلك المعلومات المهنية ووثائق الهوية/الدراسة/الشركة المقدمة لأغراض التحقق.',
        'بيانات الخدمات والمعاملات مثل الطلبات والعروض والخدمات والحجوزات وحركة المحفظة وبيانات الدفع.',
        'بيانات التواصل مثل الرسائل داخل الدردشة وطلبات الدعم.',
        'البيانات التقنية وبيانات الاستخدام مثل عنوان IP ونوع المتصفح/الجهاز وسجلات النظام وتحليلات التفاعل.',
        'الملفات والمرفقات التي ترفعها مثل المستندات والصور.',
      ],
    },
    {
      title: '2. كيفية استخدام البيانات',
      paragraphs: ['نستخدم البيانات الشخصية من أجل:'],
      bullets: [
        'إنشاء الحسابات وإدارتها وتوثيق المستخدمين وتأمين الجلسات.',
        'تشغيل خصائص المنصة مثل الملفات الشخصية والخدمات والطلبات والعروض والدردشة وعمليات المحفظة.',
        'التحقق من الأهلية والهوية وحالة الامتثال للخبراء والشركات.',
        'معالجة عمليات الإيداع وأحداث الدفع وسجلات المعاملات.',
        'تقديم الدعم والتواصل التشغيلي المرتبط بالحساب.',
        'رصد إساءة الاستخدام ومنع الاحتيال والتحقيق في الحوادث وتطبيق سياسات المنصة.',
        'تحسين جودة المنتج والأداء وتجربة المستخدم.',
      ],
    },
    {
      title: '3. الأسس القانونية للمعالجة',
      paragraphs: [
        'عند الاقتضاء، تتم المعالجة على أساس تنفيذ العقد، والمصلحة المشروعة، والالتزامات القانونية، والموافقة في الحالات التي تتطلب ذلك.',
      ],
    },
    {
      title: '4. كيفية مشاركة البيانات',
      paragraphs: ['قد نشارك البيانات مع:'],
      bullets: [
        'مستخدمين آخرين بالقدر اللازم لتقديم وظائف المنصة.',
        'مزودي خدمات يدعمون الاستضافة والبنية التحتية والاتصالات والتحليلات والتحقق والدفع.',
        'الجهات التنظيمية أو القضائية أو الأمنية عند وجود التزام قانوني أو لحماية الحقوق والسلامة والأمن.',
        'المستشارين المهنيين والمدققين وفق التزامات السرية.',
      ],
    },
    {
      title: '5. نقل البيانات عبر الحدود',
      paragraphs: [
        'قد تتم معالجة بعض البيانات خارج بلدك من خلال مزودي خدمات خارجيين. وفي هذه الحالة نطبق ضمانات معقولة تتناسب مع حساسية البيانات.',
      ],
    },
    {
      title: '6. مدة الاحتفاظ بالبيانات',
      paragraphs: [
        'نحتفظ بالبيانات طالما كان ذلك ضروريا لتقديم الخدمات والوفاء بالالتزامات القانونية والمحاسبية وحل النزاعات وتطبيق الاتفاقيات.',
      ],
    },
    {
      title: '7. إجراءات الأمان',
      paragraphs: [
        'نطبق ضوابط إدارية وتقنية وتنظيمية لحماية البيانات من الوصول غير المصرح به أو الفقد أو سوء الاستخدام أو التعديل.',
      ],
    },
    {
      title: '8. حقوقك وخياراتك',
      paragraphs: ['حسب القانون المطبق، قد يكون لك الحق في:'],
      bullets: [
        'الوصول إلى بياناتك وتصحيحها.',
        'طلب حذف بعض البيانات وفق القيود القانونية والتشغيلية.',
        'الاعتراض على بعض عمليات المعالجة أو تقييدها.',
        'سحب الموافقة عندما تكون المعالجة مبنية على الموافقة.',
        'طلب تعطيل الحساب.',
      ],
    },
    {
      title: '9. الأطفال والحد الأدنى للعمر',
      paragraphs: [
        'منصة MohandisHub غير موجهة للأطفال، ويجب استيفاء الحد الأدنى للعمر المطلوب للتسجيل والاستخدام.',
      ],
    },
    {
      title: '10. ملفات تعريف الارتباط',
      paragraphs: [
        'نستخدم ملفات تعريف الارتباط وتقنيات مشابهة لأغراض المصادقة والأمان وتفضيلات المستخدم واستمرارية الجلسة والتحليلات.',
      ],
    },
    {
      title: '11. تحديثات السياسة',
      paragraphs: [
        'قد نقوم بتحديث هذه السياسة دوريا. يتم نشر النسخة المحدثة في هذه الصفحة مع تاريخ التحديث والإصدار.',
      ],
    },
  ],
  contactTitle: 'تواصل معنا',
  contactLines: [
    'للاستفسارات أو الطلبات المتعلقة بالخصوصية، يرجى التواصل عبر',
    'support@mohandishub.com',
  ],
};

const TERMS_EN: LegalDocumentContent = {
  updatedLabel: 'Last updated',
  versionLabel: 'Terms version',
  updatedAt: 'March 9, 2026',
  version: '2026-03',
  intro: [
    'These Terms and Conditions govern your access to and use of MohandisHub services, including our website, application, and related features.',
    'By registering, accessing, or using MohandisHub, you agree to be bound by these Terms. If you do not agree, do not use the platform.',
  ],
  sections: [
    {
      title: '1. Eligibility and Account Registration',
      paragraphs: [
        'You must provide accurate information during registration and maintain up-to-date account data.',
        'You are responsible for account credentials, account activity, and all actions performed through your account.',
      ],
    },
    {
      title: '2. Platform Role',
      paragraphs: [
        'MohandisHub is a marketplace technology platform that connects customers with experts and businesses.',
        'Unless explicitly stated otherwise, MohandisHub is not a party to agreements formed directly between users and does not guarantee outcomes, quality, legality, or suitability of user-provided services.',
      ],
    },
    {
      title: '3. User Roles and Responsibilities',
      paragraphs: ['Users must act lawfully and professionally according to their role.'],
      bullets: [
        'Customers: provide accurate project/service requirements and communicate in good faith.',
        'Experts: provide truthful qualifications, comply with verification rules, and deliver services responsibly.',
        'Businesses: provide accurate legal/company details and maintain valid business information.',
      ],
    },
    {
      title: '4. Verification and Compliance',
      paragraphs: [
        'Certain features may require identity, academic, or business verification. You agree to submit accurate documentation and cooperate with verification requests.',
        'We may suspend, restrict, or reject access where verification, legal, or risk checks are incomplete or unsatisfactory.',
      ],
    },
    {
      title: '5. Services, Needs, Bids, and Communications',
      paragraphs: [
        'Users may publish services, post needs, submit bids, and communicate through platform channels in accordance with applicable product rules.',
        'You are solely responsible for the content you submit and any commitments you make to other users.',
      ],
    },
    {
      title: '6. Wallet, Payments, and Fees',
      paragraphs: [
        'MohandisHub may provide wallet-ledger features, deposits, and transaction history.',
        'Payment providers, processors, and third-party services may have additional terms that apply to payment-related actions.',
        'Platform fees, commissions, limits, and payment controls may change in line with product and compliance requirements.',
      ],
    },
    {
      title: '7. Acceptable Use',
      paragraphs: ['You must not:'],
      bullets: [
        'Use the platform for unlawful, fraudulent, abusive, or deceptive activities.',
        'Upload malicious code, attempt unauthorized access, or interfere with system integrity.',
        'Impersonate others, misrepresent credentials, or provide false verification information.',
        'Publish content that infringes rights, violates law, or harms users or the platform.',
      ],
    },
    {
      title: '8. User Content and License',
      paragraphs: [
        'You retain ownership of content you submit, but grant MohandisHub a non-exclusive, worldwide, royalty-free license to host, store, reproduce, adapt, and display such content solely for operating, improving, and securing the platform.',
      ],
    },
    {
      title: '9. Intellectual Property',
      paragraphs: [
        'The platform, software, design, trademarks, and related materials are owned by MohandisHub or its licensors and are protected by applicable laws. You may not copy, reverse engineer, redistribute, or exploit protected materials without authorization.',
      ],
    },
    {
      title: '10. Suspension and Termination',
      paragraphs: [
        'We may suspend, restrict, or terminate accounts or specific features for security, compliance, policy, or abuse reasons.',
        'You may request account closure subject to outstanding obligations, dispute handling, and legal retention requirements.',
      ],
    },
    {
      title: '11. Disclaimers',
      paragraphs: [
        'The platform is provided on an “as is” and “as available” basis to the maximum extent permitted by law. We do not warrant uninterrupted operation, complete accuracy, or error-free performance.',
      ],
    },
    {
      title: '12. Limitation of Liability',
      paragraphs: [
        'To the extent permitted by law, MohandisHub will not be liable for indirect, incidental, special, consequential, or punitive damages, including lost profits, lost data, or business interruption arising from use of the platform.',
      ],
    },
    {
      title: '13. Indemnification',
      paragraphs: [
        'You agree to defend, indemnify, and hold harmless MohandisHub and its affiliates, officers, employees, and agents from claims, liabilities, losses, and expenses arising from your misuse of the platform, violation of these Terms, or infringement of rights.',
      ],
    },
    {
      title: '14. Governing Law and Dispute Resolution',
      paragraphs: [
        'These Terms are governed by the laws of the Arab Republic of Egypt, without prejudice to mandatory legal protections that may apply under relevant law.',
      ],
    },
    {
      title: '15. Changes to These Terms',
      paragraphs: [
        'We may revise these Terms from time to time. Updated versions become effective when posted, unless stated otherwise. Continued use after updates means you accept the revised Terms.',
      ],
    },
  ],
  contactTitle: 'Contact Us',
  contactLines: [
    'For legal, contractual, or policy inquiries, contact us at',
    'support@mohandishub.com',
  ],
};

const TERMS_AR: LegalDocumentContent = {
  updatedLabel: 'آخر تحديث',
  versionLabel: 'إصدار الشروط',
  updatedAt: '9 مارس 2026',
  version: '2026-03',
  intro: [
    'تنظم هذه الشروط والأحكام وصولك إلى خدمات MohandisHub واستخدامك لها، بما في ذلك الموقع والتطبيق والخصائص المرتبطة.',
    'باستخدامك المنصة أو التسجيل فيها، فإنك توافق على الالتزام بهذه الشروط. إذا لم توافق، يرجى عدم استخدام المنصة.',
  ],
  sections: [
    {
      title: '1. الأهلية وتسجيل الحساب',
      paragraphs: [
        'يجب تقديم معلومات صحيحة عند التسجيل وتحديث بيانات الحساب عند الحاجة.',
        'أنت مسؤول عن سرية بيانات الدخول وعن جميع الأنشطة المنفذة من خلال حسابك.',
      ],
    },
    {
      title: '2. دور المنصة',
      paragraphs: [
        'MohandisHub منصة تقنية وسيطة تربط العملاء بالخبراء والشركات.',
        'ما لم يذكر خلاف ذلك صراحة، فإن MohandisHub ليست طرفا مباشرا في الاتفاقات المبرمة بين المستخدمين ولا تضمن النتائج أو جودة الخدمات المقدمة من المستخدمين.',
      ],
    },
    {
      title: '3. الأدوار والمسؤوليات',
      paragraphs: ['يلتزم المستخدمون بالتصرف المهني والقانوني وفقا لدور كل مستخدم.'],
      bullets: [
        'العملاء: تقديم متطلبات واضحة وصحيحة والتعامل بحسن نية.',
        'الخبراء: تقديم بيانات مهنية صحيحة والالتزام بإجراءات التحقق وتقديم الخدمة بمسؤولية.',
        'الشركات: تقديم بيانات قانونية وتجارية دقيقة وتحديثها باستمرار.',
      ],
    },
    {
      title: '4. التحقق والامتثال',
      paragraphs: [
        'قد تتطلب بعض الميزات التحقق من الهوية أو المؤهلات أو بيانات الشركة. وتلتزم بتقديم مستندات دقيقة والتعاون مع متطلبات التحقق.',
        'يجوز لنا تعليق أو تقييد أو رفض الوصول عند عدم اكتمال التحقق أو وجود مخاطر أو التزامات قانونية.',
      ],
    },
    {
      title: '5. الخدمات والطلبات والعروض والتواصل',
      paragraphs: [
        'يمكن للمستخدمين نشر الخدمات أو الطلبات أو العروض والتواصل داخل المنصة وفقا لقواعد المنتج.',
        'أنت مسؤول مسؤولية كاملة عن المحتوى الذي تنشره والالتزامات التي تقدمها للغير.',
      ],
    },
    {
      title: '6. المحفظة والمدفوعات والرسوم',
      paragraphs: [
        'قد توفر المنصة ميزات المحفظة وسجل المعاملات وعمليات الإيداع.',
        'قد تخضع العمليات المالية لشروط إضافية من مزودي الدفع والخدمات الخارجية.',
        'قد يتم تعديل الرسوم والعمولات والحدود وضوابط الدفع بحسب متطلبات التشغيل والامتثال.',
      ],
    },
    {
      title: '7. الاستخدام المقبول',
      paragraphs: ['يُحظر عليك:'],
      bullets: [
        'استخدام المنصة في أنشطة غير قانونية أو احتيالية أو مسيئة.',
        'محاولة الوصول غير المصرح به أو الإضرار بسلامة النظام.',
        'انتحال الشخصية أو تقديم معلومات أو وثائق مضللة.',
        'نشر محتوى ينتهك حقوق الغير أو القوانين أو يسبب ضررا للمستخدمين أو المنصة.',
      ],
    },
    {
      title: '8. محتوى المستخدم والترخيص',
      paragraphs: [
        'تحتفظ بملكية المحتوى الذي ترفعه، وتمنح MohandisHub ترخيصا غير حصري وعالمي وخاليا من الإتاوات لاستضافة المحتوى وتخزينه وعرضه ومعالجته بما يلزم لتشغيل المنصة وتحسينها وتأمينها.',
      ],
    },
    {
      title: '9. الملكية الفكرية',
      paragraphs: [
        'المنصة وبرمجياتها وتصميمها وعلاماتها وموادها محمية قانونيا ومملوكة لـ MohandisHub أو مرخصيها. ولا يجوز النسخ أو الهندسة العكسية أو إعادة التوزيع دون تصريح.',
      ],
    },
    {
      title: '10. التعليق وإنهاء الخدمة',
      paragraphs: [
        'يجوز لنا تعليق أو تقييد أو إنهاء الحساب أو بعض الميزات لأسباب أمنية أو تنظيمية أو بسبب مخالفة السياسات.',
        'يمكنك طلب إغلاق الحساب مع مراعاة الالتزامات القائمة ومتطلبات حفظ السجلات القانونية.',
      ],
    },
    {
      title: '11. إخلاء المسؤولية',
      paragraphs: [
        'يتم تقديم المنصة \"كما هي\" و\"حسب التوفر\" في الحدود التي يسمح بها القانون، دون ضمانات صريحة أو ضمنية بشأن الاستمرارية الكاملة أو الخلو من الأخطاء.',
      ],
    },
    {
      title: '12. حدود المسؤولية',
      paragraphs: [
        'في الحدود التي يسمح بها القانون، لا تتحمل MohandisHub المسؤولية عن الأضرار غير المباشرة أو العرضية أو التبعية أو فقد الأرباح أو البيانات الناتجة عن استخدام المنصة.',
      ],
    },
    {
      title: '13. التعويض',
      paragraphs: [
        'توافق على تعويض وإبراء ذمة MohandisHub والشركات التابعة لها وموظفيها ووكلائها من المطالبات أو الخسائر أو المصاريف الناتجة عن إساءة استخدامك للمنصة أو مخالفتك لهذه الشروط.',
      ],
    },
    {
      title: '14. القانون الواجب التطبيق',
      paragraphs: [
        'تخضع هذه الشروط لقوانين جمهورية مصر العربية، مع مراعاة أي حماية قانونية إلزامية واجبة التطبيق.',
      ],
    },
    {
      title: '15. تعديل الشروط',
      paragraphs: [
        'يجوز لنا تعديل هذه الشروط من وقت لآخر. تصبح النسخة المحدثة نافذة من تاريخ نشرها ما لم ينص على خلاف ذلك. استمرار الاستخدام بعد التحديث يعد موافقة على الشروط المعدلة.',
      ],
    },
  ],
  contactTitle: 'تواصل معنا',
  contactLines: [
    'للاستفسارات القانونية أو التعاقدية، يرجى التواصل عبر',
    'support@mohandishub.com',
  ],
};

export const getPrivacyContent = (locale: Locale): LegalDocumentContent => {
  return locale === 'ar' ? PRIVACY_AR : PRIVACY_EN;
};

export const getTermsContent = (locale: Locale): LegalDocumentContent => {
  return locale === 'ar' ? TERMS_AR : TERMS_EN;
};
