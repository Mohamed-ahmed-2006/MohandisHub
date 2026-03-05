import type { ServicesCatalogResponse } from '@mohandishub/shared';

import { ServicesRepository } from './services.repository.js';

export class ServicesService {
  public constructor(
    private readonly servicesRepository: ServicesRepository = new ServicesRepository(),
  ) {}

  public getStatus(): string {
    return this.servicesRepository.getPlaceholder();
  }

  public getCatalog(): ServicesCatalogResponse {
    return this.servicesRepository.getCatalog();
  }
}
