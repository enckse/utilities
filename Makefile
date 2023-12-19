BUILD   := build/
OBJECTS := $(BUILD)git-uncommitted $(BUILD)git-oclone $(BUILD)sys-update $(BUILD)transcode-media
VERSION := $(shell sha256sum *.ts | grep -v "generated.ts" | cut -d " " -f 1 | sha256sum | cut -d " " -f 1 | cut -c 1-7)

all: $(OBJECTS)

generated.ts: generated.ts.template $(shell ls *.ts | grep -v generated)
	cat generated.ts.template | sed "s/VERSION/$(VERSION)/g" > generated.ts

$(OBJECTS): generated.ts *.ts
	deno task $(shell basename $@ | cut -d "." -f 1)
