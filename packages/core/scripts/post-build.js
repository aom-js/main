import { renameSync, readdirSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');
const cjsDir = join(distDir, 'cjs');
const mjsDir = join(distDir, 'mjs');

// Перемещаем файлы из cjs в корень dist
readdirSync(cjsDir).forEach(file => {
  if (file.endsWith('.js')) {
    renameSync(join(cjsDir, file), join(distDir, file));
  }
});

// Перемещаем файлы из mjs в корень dist и переименовываем в .mjs
readdirSync(mjsDir).forEach(file => {
  if (file.endsWith('.js')) {
    renameSync(join(mjsDir, file), join(distDir, file.replace('.js', '.mjs')));
  }
}); 