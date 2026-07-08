/**
 * Database module — registered globally so any module can inject PoolManagerService
 * โดยไม่ต้อง import DbModule ซ้ำ
 */

import { Global, Module } from '@nestjs/common';
import { PoolManagerService } from './pool-manager.service';
import { ConnectionRegistryService } from './connection-registry.service';

@Global()
@Module({
  providers: [ConnectionRegistryService, PoolManagerService],
  exports: [ConnectionRegistryService, PoolManagerService],
})
export class DbModule {}
