import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * @UseGuards(JwtAuthGuard) — ใช้ใน controller ที่ต้องการ auth
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
