-- 0.34.x: the colour slot (1..10, core/env-colors.ts) of each environment, shown on its flow tabs, picker and chips.
-- NULL means automatic (the slot follows creation order at read time). Every environment that exists now gets a stored slot
-- by creation order, so its colour never moves when others are added or removed. `envs.colors` (component slots) is untouched.
ALTER TABLE envs ADD COLUMN color INTEGER;
UPDATE envs SET color = (SELECT count(*) FROM envs e WHERE e.created_at < envs.created_at OR (e.created_at = envs.created_at AND e.name < envs.name)) % 10 + 1;
