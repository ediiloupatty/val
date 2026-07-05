-- HARI 1: 2 Player (MBG & 19Jt)
-- Insert Profiles
INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at) VALUES
('dev-seed-mbg', 'MBG', 54194, 95.7, 193.1, '2026-06-28T15:00:00.000Z'),
('dev-seed-19jt', '19Jt', 52588, 94.5, 199.2, '2026-06-28T15:00:00.000Z')
ON CONFLICT(device_id) DO UPDATE SET
name = excluded.name, score = excluded.score, accuracy = excluded.accuracy, split = excluded.split, updated_at = excluded.updated_at;

-- Insert Scores (Mode: micro)
INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES
('dev-seed-mbg', 'MBG', 54194, 95.7, 193.1, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-19jt', '19Jt', 52588, 94.5, 199.2, 'micro', 0.25, '2026-06-28T15:00:00.000Z');
