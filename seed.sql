-- Insert Profiles (Matching Micro mode best scores)
INSERT INTO profiles (device_id, name, score, accuracy, split, updated_at) VALUES
('dev-seed-mbg', 'MBG', 54194, 95.7, 193.1, '2026-06-28T15:00:00.000Z'),
('dev-seed-19jt', '19Jt', 52588, 94.5, 199.2, '2026-06-28T15:00:00.000Z'),
('dev-seed-ramonn', 'ramonn', 51832, 94.1, 203.4, '2026-06-28T15:00:00.000Z'),
('dev-seed-cipung', 'Cipung Mode Bantai', 50741, 93.6, 207.5, '2026-06-28T15:00:00.000Z'),
('dev-seed-indomie', 'indomie', 49512, 93.0, 212.1, '2026-06-28T15:00:00.000Z'),
('dev-seed-asep', 'Uri', 48325, 92.7, 215.3, '2026-06-28T15:00:00.000Z'),
('dev-seed-bambang', 'sanjhu', 47844, 92.3, 218.6, '2026-06-28T15:00:00.000Z'),
('dev-seed-empu', 'Iron Man', 46719, 91.8, 222.2, '2026-06-28T15:00:00.000Z'),
('dev-seed-fikri', 'Fikri Ganteng', 45842, 91.4, 226.3, '2026-06-28T15:00:00.000Z'),
('dev-seed-joko', 'Pahuru', 45095, 90.7, 230.8, '2026-06-28T15:00:00.000Z')
ON CONFLICT(device_id) DO UPDATE SET
name = excluded.name, score = excluded.score, accuracy = excluded.accuracy, split = excluded.split, updated_at = excluded.updated_at;

-- Insert Scores (Only for mode: micro)
DELETE FROM scores WHERE device_id IN ('dev-seed-mbg', 'dev-seed-19jt', 'dev-seed-ramonn', 'dev-seed-cipung', 'dev-seed-indomie', 'dev-seed-asep', 'dev-seed-bambang', 'dev-seed-empu', 'dev-seed-fikri', 'dev-seed-joko');

INSERT INTO scores (device_id, name, score, accuracy, split, mode, target_size, created_at) VALUES
('dev-seed-mbg', 'MBG', 54194, 95.7, 193.1, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-19jt', '19JT', 52588, 94.5, 199.2, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-ramonn', 'ramonn', 51832, 94.1, 203.4, 'micro', 0.30, '2026-06-28T15:00:00.000Z'),
('dev-seed-cipung', 'Cipung Mode Bantai', 50741, 93.6, 207.5, 'micro', 0.28, '2026-06-28T15:00:00.000Z'),
('dev-seed-indomie', 'indomie', 49512, 93.0, 212.1, 'micro', 0.28, '2026-06-28T15:00:00.000Z'),
('dev-seed-asep', 'Uri', 48325, 92.7, 215.3, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-bambang', 'sanjhu', 47844, 92.3, 218.6, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-empu', 'Iron Man', 46719, 91.8, 222.2, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-fikri', 'Fikri Ganteng', 45842, 91.4, 226.3, 'micro', 0.25, '2026-06-28T15:00:00.000Z'),
('dev-seed-joko', 'Pahuru', 45095, 90.7, 230.8, 'micro', 0.25, '2026-06-28T15:00:00.000Z');
