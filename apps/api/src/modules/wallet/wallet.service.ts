import { WalletRepository } from './wallet.repository.js';

export class WalletService {
  public constructor(
    private readonly walletRepository: WalletRepository = new WalletRepository(),
  ) {}

  public getStatus(): string {
    return this.walletRepository.getPlaceholder();
  }
}
