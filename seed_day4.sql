-- HARI 4: 1 Player (Pahuru)
-- Insert Profiles
INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at) VALUES
('dev-seed-joko', 'Pahuru', 45095, 90.7, 230.8, '2026-07-01T16:00:00.000Z')
ON CONFLICT(device_id) DO UPDATE SET
name = excluded.name, score = excluded.score, accuracy = excluded.accuracy, split = excluded.split, updated_at = excluded.updated_at;

-- Insert Scores (Mode: micro)
INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES
('dev-seed-joko', 'Pahuru', 45095, 90.7, 230.8, 'micro', 0.25, '2026-07-01T16:00:00.000Z');
