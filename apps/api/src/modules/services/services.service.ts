import { ServicesRepository } from './services.repository.js';

export class ServicesService {
  public constructor(
    private readonly servicesRepository: ServicesRepository = new ServicesRepository(),
  ) {}

  public getStatus(): string {
    return this.servicesRepository.getPlaceholder();
  }
}
