import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { AuthProvider } from '@/auth/entity/auth-provider.entity';
import { OAuthProvider } from '@/auth/enum/oauth-provider.enum';
import { PageDto } from '@/core/pagination/dto/page.dto';
import { password as passwordUtil } from '@/core/utils/password.util';
import { JobPublisherService } from '@/infra/queue/services/job-publisher.service';
import { EVENTS } from '@/notifications/events/events';
import { SanitizedUser, User } from '@/users/entity/user.entity';
import { InviteStatus } from '@/users/invites/enum/invite-status.enum';
import { InvitesRepository } from '@/users/invites/repos/invites.repository';
import { UsersRepository } from '@/users/repos/users.repository';
import { GetUsersQueryDto, UpdateUserDto } from '../dto/user.dto';
import { UserRole } from '../enum/user-role.enum';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly invitesRepository: InvitesRepository,
    private readonly jobPublisher: JobPublisherService,
    @InjectEntityManager() readonly entityManager: EntityManager,
  ) {}

  private static generateDemoPassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const syms = '!@#$%^&*';
    const all = upper + lower + digits + syms;
    const pick = (chars: string) => chars[randomBytes(1)[0] % chars.length];
    const chars = [
      pick(upper),
      pick(lower),
      pick(digits),
      pick(syms),
      ...Array.from({ length: 12 }, () => all[randomBytes(1)[0] % all.length]),
    ];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  async createDemoUser(): Promise<User> {
    const nanoId = randomBytes(8).toString('base64url').slice(0, 10);
    const email = `demo_${nanoId}@demo.local`;
    const hashedPassword = await passwordUtil.hash(
      UsersService.generateDemoPassword(),
    );
    return this.createUserWithLocalAuth(
      email,
      hashedPassword,
      [UserRole.USER],
      undefined,
      `Cracker#${nanoId.slice(0, 4).toUpperCase()}`,
      undefined,
      true,
    );
  }

  private async createUserWithLocalAuth(
    email: string,
    hashedPassword: string,
    roles: UserRole[],
    picture?: string,
    displayName?: string,
    additionalTransactionOps?: (txManager: EntityManager) => Promise<void>,
    isDemo = false,
  ): Promise<User> {
    return this.entityManager.transaction(async txManager => {
      const user = txManager.create(User, {
        email,
        password: hashedPassword,
        displayName: displayName || email.split('@')[0],
        picture,
        roles,
        isDemo,
      });
      const savedUser = await txManager.save(User, user);

      const authProvider = txManager.create(AuthProvider, {
        userId: savedUser.id,
        provider: OAuthProvider.LOCAL,
        authProviderId: null,
        passwordHash: hashedPassword,
      });
      await txManager.save(AuthProvider, authProvider);

      if (additionalTransactionOps) {
        await additionalTransactionOps(txManager);
      }

      return savedUser;
    });
  }

  async getUsersPaginated(
    getUsersQueryDto: GetUsersQueryDto,
  ): Promise<PageDto<SanitizedUser>> {
    return this.usersRepository.getUsersPaginated(getUsersQueryDto);
  }

  async findById(id: string): Promise<SanitizedUser | null> {
    return this.usersRepository.findById(id);
  }

  async createUser(
    email: string,
    password: string,
    picture?: string,
    displayName?: string,
  ): Promise<User> {
    const hashedPassword = await passwordUtil.hash(password);
    const user = await this.createUserWithLocalAuth(
      email,
      hashedPassword,
      [UserRole.USER],
      picture,
      displayName,
    );

    // Publish user registered event
    await this.jobPublisher.publishJob(
      EVENTS.ROUTING_KEYS.USER_REGISTERED,
      {
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        type: 'direct',
      },
      { emitToAdmins: true, queue: EVENTS.QUEUES.BACKGROUND_JOBS },
    );

    return user;
  }

  async createUserFromInvite(
    inviteCode: string,
    password: string,
    picture?: string,
    displayName?: string,
  ) {
    const invite = await this.invitesRepository.findOne({
      where: {
        inviteCode,
        status: InviteStatus.PENDING,
      },
    });
    if (!invite) {
      throw new ForbiddenException('Invalid invite');
    }

    if (invite.expiresAt < new Date()) {
      invite.status = InviteStatus.EXPIRED;
      await this.invitesRepository.save(invite);
      throw new ForbiddenException('Expired invite');
    }

    const hashedPassword = await passwordUtil.hash(password);
    const user = await this.createUserWithLocalAuth(
      invite.email,
      hashedPassword,
      [invite.role],
      picture,
      displayName,
      async txManager => {
        invite.status = InviteStatus.ACCEPTED;
        await txManager.save(invite);
      },
    );

    await this.jobPublisher.publishJob(
      EVENTS.ROUTING_KEYS.USER_REGISTERED,
      {
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        type: 'invite',
      },
      { emitToAdmins: true, queue: EVENTS.QUEUES.BACKGROUND_JOBS },
    );

    return user;
  }

  async updateUser(userId: string, updateUserDto: UpdateUserDto) {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const toUpdateUserDto = {
      ...user,
      ...updateUserDto,
    };
    return this.usersRepository.save(toUpdateUserDto);
  }
}
