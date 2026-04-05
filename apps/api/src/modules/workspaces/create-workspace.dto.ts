import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  login!: string;
}
