import type { ServicesCatalogResponse } from '@mohandishub/shared';

export class ServicesRepository {
  public getPlaceholder(): string {
    return 'Services module placeholder';
  }

  public getCatalog(): ServicesCatalogResponse {
    return {
      categories: [
        {
          id: 'cat-consulting',
          slug: 'consulting',
          name: 'Engineering Consulting',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'cat-design',
          slug: 'design',
          name: 'Design & Drawings',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'cat-site',
          slug: 'site-supervision',
          name: 'Site Supervision',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
      ],
      services: [
        {
          id: 'svc-feasibility',
          slug: 'feasibility-study',
          name: 'Feasibility Study',
          categoryId: 'cat-consulting',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'svc-structural-consult',
          slug: 'structural-consultation',
          name: 'Structural Consultation',
          categoryId: 'cat-consulting',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'svc-architectural',
          slug: 'architectural-drawings',
          name: 'Architectural Drawings',
          categoryId: 'cat-design',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'svc-mep',
          slug: 'mep-design',
          name: 'MEP Design',
          categoryId: 'cat-design',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'svc-inspection',
          slug: 'site-inspection',
          name: 'Site Inspection',
          categoryId: 'cat-site',
          roleVisibility: ['customer', 'expert', 'business', 'admin'],
        },
        {
          id: 'svc-quality-control',
          slug: 'quality-control-audit',
          name: 'Quality Control Audit',
          categoryId: 'cat-site',
          roleVisibility: ['business', 'expert', 'admin'],
        },
      ],
    };
  }
}
