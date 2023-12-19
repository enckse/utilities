BUILD   := build/
OBJECTS := $(BUILD)git-uncommitted $(BUILD)git-oclone $(BUILD)sys-update $(BUILD)transcode-media
VERSION := $(shell sha256sum src/*.ts | grep -v "generate" | cut -d " " -f 1 | sha256sum | cut -d " " -f 1 | cut -c 1-7)
DESTDIR := /usr/local/bin

all: $(OBJECTS)

clean:
	rm -rf $(BUILD)

src/generated.ts: $(shell ls src/*.ts | grep -v generate)
	cat src/generate.template.ts | sed "s/VERSION/$(VERSION)/g" > src/generated.ts

$(OBJECTS): src/*.ts src/generated.ts
	deno task $(shell basename $@ | cut -d "." -f 1)

install:
	cp -v $(BUILD)* $(DESTDIR)/
