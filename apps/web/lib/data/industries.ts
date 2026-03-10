/**
 * Industries with optional sub-industries for cascading select.
 */
export type IndustryEntry = {
  id: string;
  nameEn: string;
  nameAr: string;
  subIndustries?: { id: string; nameEn: string; nameAr: string }[];
};

export const INDUSTRIES: IndustryEntry[] = [
  {
    id: 'construction',
    nameEn: 'Construction',
    nameAr: 'البناء والتشييد',
    subIndustries: [
      { id: 'residential', nameEn: 'Residential', nameAr: 'سكني' },
      { id: 'commercial', nameEn: 'Commercial', nameAr: 'تجاري' },
      { id: 'industrial', nameEn: 'Industrial', nameAr: 'صناعي' },
      { id: 'infrastructure', nameEn: 'Infrastructure', nameAr: 'بنية تحتية' },
    ],
  },
  {
    id: 'mechanical',
    nameEn: 'Mechanical Engineering',
    nameAr: 'الهندسة الميكانيكية',
    subIndustries: [
      { id: 'hvac', nameEn: 'HVAC', nameAr: 'التكييف والتبريد' },
      { id: 'plumbing', nameEn: 'Plumbing', nameAr: 'السباكة' },
      { id: 'machinery', nameEn: 'Machinery', nameAr: 'الآلات' },
      { id: 'automotive', nameEn: 'Automotive', nameAr: 'السيارات' },
    ],
  },
  {
    id: 'electrical',
    nameEn: 'Electrical Engineering',
    nameAr: 'الهندسة الكهربائية',
    subIndustries: [
      { id: 'power', nameEn: 'Power Systems', nameAr: 'أنظمة الطاقة' },
      { id: 'automation', nameEn: 'Automation', nameAr: 'الأتمتة' },
      { id: 'renewable', nameEn: 'Renewable Energy', nameAr: 'الطاقة المتجددة' },
      { id: 'lighting', nameEn: 'Lighting', nameAr: 'الإضاءة' },
    ],
  },
  {
    id: 'civil',
    nameEn: 'Civil Engineering',
    nameAr: 'الهندسة المدنية',
    subIndustries: [
      { id: 'structural', nameEn: 'Structural', nameAr: 'الإنشاءات' },
      { id: 'geotechnical', nameEn: 'Geotechnical', nameAr: 'الجيوتقنية' },
      { id: 'transportation', nameEn: 'Transportation', nameAr: 'النقل' },
      { id: 'water', nameEn: 'Water Resources', nameAr: 'موارد المياه' },
    ],
  },
  {
    id: 'architecture',
    nameEn: 'Architecture',
    nameAr: 'العمارة',
    subIndustries: [
      { id: 'interior', nameEn: 'Interior Design', nameAr: 'التصميم الداخلي' },
      { id: 'landscape', nameEn: 'Landscape', nameAr: 'تنسيق المواقع' },
      { id: 'urban', nameEn: 'Urban Planning', nameAr: 'التخطيط العمراني' },
    ],
  },
  {
    id: 'software',
    nameEn: 'Software & IT',
    nameAr: 'البرمجيات وتقنية المعلومات',
    subIndustries: [
      { id: 'web', nameEn: 'Web Development', nameAr: 'تطوير الويب' },
      { id: 'mobile', nameEn: 'Mobile Apps', nameAr: 'تطبيقات الجوال' },
      { id: 'cad-bim', nameEn: 'CAD/BIM', nameAr: 'الرسم والتصميم بالحاسوب' },
      { id: 'erp', nameEn: 'ERP Systems', nameAr: 'أنظمة تخطيط الموارد' },
    ],
  },
  {
    id: 'consulting',
    nameEn: 'Engineering Consulting',
    nameAr: 'الاستشارات الهندسية',
    subIndustries: [
      { id: 'feasibility', nameEn: 'Feasibility Studies', nameAr: 'دراسات الجدوى' },
      { id: 'project-mgmt', nameEn: 'Project Management', nameAr: 'إدارة المشاريع' },
      { id: 'inspection', nameEn: 'Inspection & Testing', nameAr: 'الفحص والاختبار' },
    ],
  },
  {
    id: 'manufacturing',
    nameEn: 'Manufacturing',
    nameAr: 'التصنيع',
    subIndustries: [
      { id: 'metal', nameEn: 'Metal & Fabrication', nameAr: 'المعادن والتشغيل' },
      { id: 'mep', nameEn: 'MEP Systems', nameAr: 'أنظمة MEP' },
      { id: 'precast', nameEn: 'Precast Concrete', nameAr: 'الخرسانة سابقة الصب' },
    ],
  },
  {
    id: 'other',
    nameEn: 'Other',
    nameAr: 'أخرى',
  },
];
