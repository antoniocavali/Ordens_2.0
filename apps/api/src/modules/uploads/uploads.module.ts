import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  // O Atendimento reutiliza o pipeline de upload para as imagens do chat.
  exports: [UploadsService],
})
export class UploadsModule {}
