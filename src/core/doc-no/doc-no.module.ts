/**
 * Doc-No module — registered globally so any feature module can inject DocNoService
 * โดยไม่ต้อง import ซ้ำ
 *
 * Caller ส่ง (database, formatCode, docDate, transFlag) — core ไม่รู้จัก domain-specific
 * default (เช่น CN_FORMAT_CODE) — แต่ละ caller ต้อง resolve เอง
 */

import { Global, Module } from '@nestjs/common';
import { DocNoRepository } from './doc-no.repository';
import { DocNoService } from './doc-no.service';

@Global()
@Module({
  providers: [DocNoService, DocNoRepository],
  exports: [DocNoService],
})
export class DocNoModule {}
