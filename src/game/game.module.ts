import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/infra/db/database.module';
import { PgLockModule } from '@/infra/db/lock/pg-lock.module';
import { CrashEngineService } from './engine/crash-engine.service';
import { GameBet } from './entity/game-bet.entity';
import { GameRound } from './entity/game-round.entity';
import { Wallet } from './entity/wallet.entity';
import { WalletTransaction } from './entity/wallet-transaction.entity';
import { GameController } from './game.controller';
import { GameGateway } from './game.gateway';
import { GameLifecycleHandler } from './handlers/game-lifecycle.handler';
import { GameBetRepository } from './repos/game-bet.repository';
import { GameRoundRepository } from './repos/game-round.repository';
import { WalletRepository } from './repos/wallet.repository';
import { WalletTransactionRepository } from './repos/wallet-transaction.repository';
import { DemoService } from './services/demo.service';
import { GameBetService } from './services/game-bet.service';
import { GameRoundService } from './services/game-round.service';
import { WalletService } from './services/wallet.service';
import { WalletController } from './wallet.controller';

/**
 * GameModule wires up the entire crash game feature.
 *
 * Global dependencies (no import needed):
 *   - PaginationFactory  (@Global PaginationModule)
 *   - PgLockService      (@Global PgLockModule via DatabaseModule)
 *   - JobPublisherService (@Global NotificationModule → NotificationQueueModule)
 *   - EventsGateway      (@Global EventsModule.forRoot())
 *   - DataSource         (TypeORM global provider)
 *   - RedisService       (@Global RedisModule)
 *
 * CrashEngineService ↔ GameGateway circular dependency is resolved via
 * a registered tick-emitter callback (GameGateway.onModuleInit calls
 * CrashEngineService.registerTickEmitter), avoiding circular ES module imports.
 */
@Module({
  imports: [
    // Registers Repository<GameRound>, Repository<GameBet>, etc.
    DatabaseModule.forFeature([GameRound, GameBet, Wallet, WalletTransaction]),
    // Provides PgLockService (advisory locks used by GameBetService)
    PgLockModule,
  ],
  controllers: [GameController, WalletController],
  providers: [
    // Repositories
    GameRoundRepository,
    GameBetRepository,
    WalletRepository,
    WalletTransactionRepository,
    // Services
    GameRoundService,
    GameBetService,
    WalletService,
    DemoService,
    // Engine — registers tick callback on GameGateway.onModuleInit()
    CrashEngineService,
    // Job handlers (auto-discovered by JobDispatcherService via DiscoveryService)
    GameLifecycleHandler,
    // WebSocket gateway — calls CrashEngineService.registerTickEmitter on init
    GameGateway,
  ],
  exports: [
    GameRoundService,
    GameBetService,
    WalletService,
    CrashEngineService,
    GameGateway,
  ],
})
export class GameModule {}
