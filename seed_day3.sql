-- HARI 3: 4 Player (Uri, sanjhu, Iron Man, Fikri Ganteng)
-- Insert Profiles
INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at) VALUES
('dev-seed-asep', 'Uri', 48325, 92.7, 215.3, '2026-06-30T14:00:00.000Z'),
('dev-seed-bambang', 'sanjhu', 47844, 92.3, 218.6, '2026-06-30T14:00:00.000Z'),
('dev-seed-empu', 'Iron Man', 46719, 91.8, 222.2, '2026-06-30T14:00:00.000Z'),
('dev-seed-fikri', 'Fikri Ganteng', 45842, 91.4, 226.3, '2026-06-30T14:00:00.000Z')
ON CONFLICT(device_id) DO UPDATE SET
name = excluded.name, score = excluded.score, accuracy = excluded.accuracy, split = excluded.split, updated_at = excluded.updated_at;

-- Insert Scores (Mode: micro)
INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES
('dev-seed-asep', 'Uri', 48325, 92.7, 215.3, 'micro', 0.25, '2026-06-30T14:00:00.000Z'),
('dev-seed-bambang', 'sanjhu', 47844, 92.3, 218.6, 'micro', 0.25, '2026-06-30T14:00:00.000Z'),
('dev-seed-empu', 'Iron Man', 46719, 91.8, 222.2, 'micro', 0.25, '2026-06-30T14:00:00.000Z'),
('dev-seed-fikri', 'Fikri Ganteng', 45842, 91.4, 226.3, 'micro', 0.25, '2026-06-30T14:00:00.000Z');
