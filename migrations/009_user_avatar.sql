-- Foto de perfil. Se guarda como data URL (JPEG/WebP ya reducido a 256px en
-- el cliente, ~20-40 KB) para no depender de un servicio de archivos. Si el
-- volumen crece, se migra a object storage y esta columna pasa a guardar la
-- URL pública.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
