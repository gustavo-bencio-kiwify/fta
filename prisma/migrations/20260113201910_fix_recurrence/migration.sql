-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "delegation" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "term" DATETIME,
    "recurrence" TEXT,
    "urgency" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_tasks" ("createdAt", "delegation", "description", "id", "recurrence", "responsible", "term", "title", "urgency") SELECT "createdAt", "delegation", "description", "id", "recurrence", "responsible", "term", "title", "urgency" FROM "tasks";
DROP TABLE "tasks";
ALTER TABLE "new_tasks" RENAME TO "tasks";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
