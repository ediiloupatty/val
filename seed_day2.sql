-- HARI 2: 3 Player (ramonn, Cipung Mode Bantai, indomie)
-- Insert Profiles
INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at) VALUES
('dev-seed-ramonn', 'ramonn', 51832, 94.1, 203.4, '2026-06-29T12:00:00.000Z'),
('dev-seed-cipung', 'Cipung Mode Bantai', 50741, 93.6, 207.5, '2026-06-29T12:00:00.000Z'),
('dev-seed-indomie', 'indomie', 49512, 93.0, 212.1, '2026-06-29T12:00:00.000Z')
ON CONFLICT(device_id) DO UPDATE SET
name = excluded.name, score = excluded.score, accuracy = excluded.accuracy, split = excluded.split, updated_at = excluded.updated_at;

-- Hapus data scores lama untuk menghindari duplikasi
DELETE FROM scores WHERE device_id IN ('dev-seed-ramonn', 'dev-seed-cipung', 'dev-seed-indomie');

-- Insert Scores (Mode: micro)
INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES
('dev-seed-ramonn', 'ramonn', 51832, 94.1, 203.4, 'micro', 0.30, '2026-06-29T12:00:00.000Z'),
('dev-seed-cipung', 'Cipung Mode Bantai', 50741, 93.6, 207.5, 'micro', 0.28, '2026-06-29T12:00:00.000Z'),
('dev-seed-indomie', 'indomie', 49512, 93.0, 212.1, 'micro', 0.28, '2026-06-29T12:00:00.000Z');
