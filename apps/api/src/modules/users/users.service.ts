import { HttpError } from '../../utils/http-error.js';

import { UsersRepository } from './users.repository.js';
import type { UserSummary } from './users.types.js';

export class UsersService {
  public constructor(private readonly usersRepository: UsersRepository = new UsersRepository()) {}

  public listUsers(): UserSummary[] {
    return this.usersRepository.listUsers();
  }

  public getUserById(id: string): UserSummary {
    const user = this.usersRepository.findById(id);

    if (!user) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: `User not found for id: ${id}`,
      });
    }

    return user;
  }
}
