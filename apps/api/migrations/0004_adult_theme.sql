-- Adults can pick an app theme too; until now they always saw the neutral style.
UPDATE member SET theme = 'neutral' WHERE role = 'parent';
