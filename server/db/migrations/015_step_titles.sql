-- Step titles (0.30.0): an optional short title (at most 80 characters, trimmed) next to a description. Used by step keys
-- (callee starting '#step:') and ignored elsewhere. NULL = none. A record may carry a title with empty text, and the other way round.
-- Same rule as the text: the human title wins over the AI title. (014 belongs to another branch; the runner needs no contiguous numbers.)
ALTER TABLE descriptions ADD COLUMN title TEXT;
