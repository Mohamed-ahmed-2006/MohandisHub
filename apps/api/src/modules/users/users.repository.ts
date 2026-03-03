import type { UserSummary } from './users.types.js';

const seedUsers: UserSummary[] = [
  { id: 'usr_1', fullName: 'Mohamed Ali', role: 'expert' },
  { id: 'usr_2', fullName: 'Sara Hassan', role: 'business' },
  { id: 'usr_3', fullName: 'Omar Mostafa', role: 'customer' },
];

export class UsersRepository {
  public listUsers(): UserSummary[] {
    return seedUsers;
  }

  public findById(id: string): UserSummary | null {
    return seedUsers.find((user) => user.id === id) ?? null;
  }
}
