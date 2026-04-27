#include <stdio.h>
#include <string.h>

int main() {
    char name[10];
    char copy[5];

    gets(name);
    strcpy(copy, name);

    for(int i = 0; i <= 5; i++); {
        printf("%s\n", copy);
    }

    return 0;
}