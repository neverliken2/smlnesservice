/**
 * Database module — registered globally so any module can inject PoolManagerService
 * โดยไม่ต้อง import DbModule ซ้ำ
 */

import { Global, Module } from '@nestjs/common';
import { PoolManagerService } from './pool-manager.service';

@Global()
@Module({
  providers: [PoolManagerService],
  exports: [PoolManagerService],
})
export class DbModule {}
