BUILD   := build/
OBJECT  := $(BUILD)utility-wrapper
VERSION := $(shell sha256sum src/*.ts | grep -v "generate" | cut -d " " -f 1 | sha256sum | cut -d " " -f 1 | cut -c 1-7)
DESTDIR := /usr/local/bin

all: $(OBJECT)

clean:
	rm -rf $(BUILD)

src/generated.ts: $(shell ls src/*.ts | grep -v generate)
	cat src/generate.template.ts | sed "s/VERSION/$(VERSION)/g" > src/generated.ts

$(OBJECT): src/*.ts src/generated.ts
	deno task compile

install:
	mkdir -p $(DESTDIR)
	cp -v $(BUILD)* $(DESTDIR)/
	$(OBJECT) generate $(DESTDIR)/
