import { ChatRepository } from './chat.repository.js';

export class ChatService {
  public constructor(private readonly chatRepository: ChatRepository = new ChatRepository()) {}

  public getStatus(): string {
    return this.chatRepository.getPlaceholder();
  }
}
