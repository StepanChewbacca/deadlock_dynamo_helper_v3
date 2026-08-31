import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/data-source';
import { DeadlockLiveModule } from './deadlock-live/deadlock-live.module';
import { StatlockerAdaptiveModule } from './statlocker-adaptive/statlocker-adaptive.module';
import { StatlockerProbeModule } from './statlocker-probe/statlocker-probe.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...databaseOptions,
      migrationsRun: process.env.DB_RUN_MIGRATIONS === 'true',
    }),
    DeadlockLiveModule,
    StatlockerAdaptiveModule,
    StatlockerProbeModule,
  ],
})
export class AppModule {}
